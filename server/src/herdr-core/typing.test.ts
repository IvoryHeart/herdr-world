import { expect, test } from "bun:test";
import type { CoreCellSize, CoreKeyboard } from "./client";
import { type CoreTyped, CoreTypingSession } from "./typing";

const size = { cols: 90, rows: 30 };
const wider = { cols: 120, rows: 36 };

type FakeSeat = CoreKeyboard & { open: boolean; log: string[] };

function session(limit = 8) {
  const opens: CoreCellSize[] = [];
  const outcomes: string[] = [];
  const typing = new CoreTypingSession({
    open: (at) => opens.push({ ...at }),
    fenced: () => true,
    maxQueuedBytes: limit,
    notSent: () => new Error("Not sent"),
  });
  const typed = (
    text: string,
    kind: "input" | "automatic" = "input",
  ): CoreTyped => ({
    kind,
    bytes: new TextEncoder().encode(text),
    size,
    done: (sent, error) =>
      outcomes.push(`${text}:${sent ? "sent" : (error?.message ?? "dropped")}`),
  });
  /** Core's interactive viewer: records every frame World sends on it. */
  const seat = (): FakeSeat => {
    const log: string[] = [];
    const keys = {
      open: true,
      automatic: true,
      log,
      input: (bytes: Uint8Array) =>
        log.push(`input ${new TextDecoder().decode(bytes)}`),
      automaticInput: (bytes: Uint8Array) =>
        log.push(`automatic ${new TextDecoder().decode(bytes)}`),
      resize: (at: CoreCellSize) => log.push(`resize ${at.cols}x${at.rows}`),
      focus: (focused: boolean) => log.push(`focus ${focused}`),
      detach: () => {
        log.push("detach");
        keys.open = false;
      },
    } as unknown as FakeSeat;
    return keys;
  };
  return { typing, typed, opens, outcomes, seat };
}

test("an open view holds a seat at its size without sending core anything", () => {
  const s = session();
  s.typing.hold(size);
  expect(s.opens).toEqual([size]);
  const seat = s.seat();
  s.typing.opened(seat);
  expect(s.typing.state).toBe("yes");
  // No RESIZE, input or FOCUS: a resumed seat never takes the size from
  // a Herdr app's pane; core gives it the size only when nothing else has it.
  expect(seat.log).toEqual([]);
  s.typing.hold(size);
  expect(s.opens).toHaveLength(1);
});

test("a new size swaps the seat: the new one is attached before the old one leaves", () => {
  const s = session();
  s.typing.hold(size);
  const first = s.seat();
  s.typing.opened(first);
  s.typing.hold(wider);
  expect(s.opens).toEqual([size, wider]);
  // The old seat still holds the size until core answered the new one.
  expect(first.log).toEqual([]);
  const second = s.seat();
  s.typing.opened(second);
  expect(first.log).toEqual(["detach"]);
  expect(second.log).toEqual([]);
});

test("sizes asked for while a seat opens coalesce into one swap to the newest", () => {
  const s = session();
  s.typing.hold(size);
  s.typing.hold(wider);
  s.typing.hold({ cols: 100, rows: 40 });
  expect(s.opens).toEqual([size]);
  s.typing.opened(s.seat());
  expect(s.opens).toEqual([size, { cols: 100, rows: 40 }]);
});

test("the first key focuses the seat and is sent once; later keys follow it", () => {
  const s = session();
  s.typing.hold(size);
  const seat = s.seat();
  s.typing.opened(seat);
  s.typing.input(s.typed("a"));
  s.typing.input(s.typed("b"));
  expect(seat.log).toEqual(["focus true", "input a", "input b"]);
  expect(s.outcomes).toEqual(["a:sent", "b:sent"]);
});

test("keys typed before the seat answers wait and go once, in order", () => {
  const s = session(8);
  s.typing.input(s.typed("abcd"));
  s.typing.input(s.typed("efgh"));
  // Core is slow to answer: this would pass the limit.
  s.typing.input(s.typed("i"));
  expect(s.outcomes).toEqual(["i:Not sent"]);
  expect(s.opens).toEqual([size]);
  const seat = s.seat();
  s.typing.opened(seat);
  expect(seat.log).toEqual(["focus true", "input abcd", "input efgh"]);
  expect(s.outcomes).toEqual(["i:Not sent", "abcd:sent", "efgh:sent"]);
});

test("a key during a swap goes on the seat that is open, never twice", () => {
  const s = session();
  s.typing.hold(size);
  const first = s.seat();
  s.typing.opened(first);
  s.typing.hold(wider);
  s.typing.input(s.typed("a"));
  const second = s.seat();
  s.typing.opened(second);
  expect(first.log).toEqual(["focus true", "input a", "focus false", "detach"]);
  expect(second.log).toEqual([]);
  s.typing.input(s.typed("b"));
  expect(second.log).toEqual(["focus true", "input b"]);
});

test("terminal replies go only on a seat a person typed into", () => {
  const s = session();
  s.typing.hold(size);
  const seat = s.seat();
  s.typing.opened(seat);
  s.typing.input(s.typed("?", "automatic"));
  expect(seat.log).toEqual([]);
  expect(s.outcomes).toEqual(["?:dropped"]);
  s.typing.input(s.typed("a"));
  s.typing.input(s.typed("!", "automatic"));
  expect(seat.log).toEqual(["focus true", "input a", "automatic !"]);
});

test("there is no give-back while the view stays open; closing leaves", () => {
  const s = session();
  s.typing.hold(size);
  const seat = s.seat();
  s.typing.opened(seat);
  s.typing.input(s.typed("a"));
  expect(seat.open).toBe(true);
  s.typing.close();
  expect(seat.log).toEqual(["focus true", "input a", "focus false", "detach"]);
  s.typing.input(s.typed("b"));
  expect(s.outcomes.at(-1)).toBe("b:Not sent");
});

test("a seat answered after the watch closed is left at once and sends nothing", () => {
  const s = session();
  s.typing.input(s.typed("a"));
  s.typing.close();
  const seat = s.seat();
  s.typing.opened(seat);
  expect(seat.log).toEqual(["detach"]);
  expect(s.outcomes).toEqual(["a:Not sent"]);
});

test("a refused swap keeps the seat that is open; a refused first seat refuses its keys", () => {
  const s = session();
  s.typing.input(s.typed("a"));
  s.typing.failed(new Error("refused"));
  expect(s.outcomes).toEqual(["a:refused"]);
  expect(s.typing.state).toBe("no");
  s.typing.hold(size);
  const seat = s.seat();
  s.typing.opened(seat);
  s.typing.hold(wider);
  s.typing.failed(new Error("refused"));
  expect(s.typing.state).toBe("yes");
  s.typing.input(s.typed("b"));
  expect(seat.log).toEqual(["focus true", "input b"]);
});

test("a seat core ended is replaced by the next key at the held size", () => {
  const s = session();
  s.typing.hold(wider);
  const seat = s.seat();
  s.typing.opened(seat);
  seat.open = false;
  s.typing.ended(seat);
  expect(s.typing.state).toBe("no");
  s.typing.input(s.typed("a"));
  expect(s.opens).toEqual([wider, wider]);
});

test("a refused fence sends nothing and opens nothing", () => {
  const outcomes: string[] = [];
  const opens: CoreCellSize[] = [];
  const typing = new CoreTypingSession({
    open: (at) => opens.push(at),
    fenced: () => false,
    maxQueuedBytes: 8,
    notSent: () => new Error("Not sent"),
  });
  typing.hold(size);
  typing.input({
    kind: "input",
    bytes: new Uint8Array([97]),
    size,
    done: (sent, error) =>
      outcomes.push(sent ? "sent" : String(error?.message)),
  });
  expect(opens).toEqual([]);
  expect(outcomes).toEqual(["Not sent"]);
});
