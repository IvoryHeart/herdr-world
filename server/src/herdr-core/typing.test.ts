import { expect, test } from "bun:test";
import type { CoreKeyboard } from "./client";
import { type CoreTyped, CoreTypingSession } from "./typing";

const size = { cols: 90, rows: 30 };

function session(limit = 8) {
  const opens: number[] = [];
  const outcomes: string[] = [];
  const typing = new CoreTypingSession({
    open: () => opens.push(opens.length),
    fenced: () => true,
    maxQueuedBytes: limit,
    notSent: () => new Error("Not sent"),
  });
  const typed = (text: string): Exclude<CoreTyped, { kind: "leave" }> => ({
    kind: "input",
    bytes: new TextEncoder().encode(text),
    size,
    done: (sent, error) =>
      outcomes.push(`${text}:${sent ? "sent" : (error?.message ?? "dropped")}`),
  });
  const keyboard = () => {
    const wrote: string[] = [];
    const keys = {
      open: true,
      automatic: true,
      input: (bytes: Uint8Array) => wrote.push(new TextDecoder().decode(bytes)),
      automaticInput: () => undefined,
      resize: () => undefined,
      focus: () => undefined,
      detach: () => {
        keys.open = false;
      },
    } as unknown as CoreKeyboard & { open: boolean };
    return { keys, wrote };
  };
  return { typing, typed, opens, outcomes, keyboard };
}

test("keys beyond the queue limit while the keyboard opens are refused; the rest go once", () => {
  const s = session(8);
  s.typing.input(s.typed("abcd"));
  s.typing.input(s.typed("efgh"));
  // Core is slow to answer: this would pass the limit.
  s.typing.input(s.typed("i"));
  expect(s.outcomes).toEqual(["i:Not sent"]);
  expect(s.opens).toHaveLength(1);
  const { keys, wrote } = s.keyboard();
  s.typing.opened(keys);
  expect(wrote).toEqual(["abcd", "efgh"]);
  expect(s.outcomes).toEqual(["i:Not sent", "abcd:sent", "efgh:sent"]);
  // Once open, nothing waits, so the limit no longer applies.
  s.typing.input(s.typed("jklmnopqr"));
  expect(wrote.at(-1)).toBe("jklmnopqr");
});

test("an attach answered after the watch closed is left at once and sends nothing", () => {
  const s = session();
  s.typing.input(s.typed("a"));
  s.typing.close();
  const { keys, wrote } = s.keyboard();
  s.typing.opened(keys);
  expect(wrote).toEqual([]);
  expect(keys.open).toBe(false);
  expect(s.outcomes).toEqual(["a:Not sent"]);
});
