import { describe, expect, test } from "bun:test";
import {
  CORE_INPUT_CHUNK,
  CoreTyping,
  type CoreInputBatch,
  fittedGrid,
  isFocusReport,
  userInputSignal,
} from "./coreTyping";

const text = (batch: CoreInputBatch) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(batch.data), (c) => c.charCodeAt(0)),
  );

/** A port whose requests answer only when the test says so. */
function harness(size = { cols: 90, rows: 30 }) {
  const log: string[] = [];
  const pending: Array<{ resolve(): void; reject(error: Error): void }> = [];
  const timers = new Map<number, () => void>();
  let next = 0;
  const refused: string[] = [];
  const changes: Array<string | null> = [];
  const typing = new CoreTyping(
    {
      input: (batch) =>
        new Promise<void>((resolve, reject) => {
          log.push(
            `${batch.automatic ? "auto" : "key"} ${JSON.stringify(text(batch))} ${batch.cols}x${batch.rows}`,
          );
          pending.push({ resolve, reject });
        }),
      leave: () => {
        log.push("leave");
        return Promise.resolve();
      },
    },
    {
      size: () => size,
      refused: (message) => refused.push(message),
      changed: (held) => changes.push(held && `${held.cols}x${held.rows}`),
      timers: {
        set: (run) => {
          timers.set(++next, run);
          return next;
        },
        clear: (handle) => timers.delete(handle as number),
      },
    },
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    typing,
    log,
    refused,
    changes,
    size,
    timers,
    settle,
    async answer(error?: Error) {
      const request = pending.shift()!;
      if (error) request.reject(error);
      else request.resolve();
      await settle();
    },
    fire(handle: number) {
      const run = timers.get(handle)!;
      timers.delete(handle);
      run();
    },
  };
}

describe("typing into a core terminal from the page", () => {
  test("one request at a time; keys typed meanwhile go together, in order", async () => {
    const h = harness();
    void h.typing.type("a");
    void h.typing.type("b");
    void h.typing.type("c");
    await h.settle();
    expect(h.log).toEqual(['key "a" 90x30']);
    await h.answer();
    expect(h.log).toEqual(['key "a" 90x30', 'key "bc" 90x30']);
    expect(h.typing.typing).toBe(true);
  });

  test("a reply never opens the keyboard and keeps its place between keys", async () => {
    const h = harness();
    await h.typing.type("\x1b[1;1R", true);
    expect(h.log).toEqual([]);
    void h.typing.type("x");
    void h.typing.type("\x1b[2;2R", true);
    void h.typing.type("y");
    await h.settle();
    await h.answer();
    await h.answer();
    await h.answer();
    expect(h.log).toEqual([
      'key "x" 90x30',
      'auto "\\u001b[2;2R" 90x30',
      'key "y" 90x30',
    ]);
  });

  test("leaving waits for the keys before it and is sent once", async () => {
    const h = harness();
    void h.typing.type("a");
    h.typing.leave();
    h.typing.leave();
    await h.settle();
    expect(h.log).toEqual(['key "a" 90x30']);
    await h.answer();
    expect(h.log).toEqual(['key "a" 90x30', "leave"]);
    expect(h.changes).toEqual(["90x30", null]);
    // Nothing typed since: no second leave.
    h.typing.leave();
    await h.settle();
    expect(h.log).toHaveLength(2);
  });

  test("a refused key drops the keys queued behind it", async () => {
    const h = harness();
    const outcome = (sent: Promise<void>) =>
      sent.then(
        () => "sent",
        (error: Error) => error.message,
      );
    const first = outcome(h.typing.type("rm "));
    const second = outcome(h.typing.type("-rf"));
    await h.settle();
    await h.answer(
      new Error("Not sent: World could not type into this terminal"),
    );
    expect(await first).toStartWith("Not sent");
    expect(await second).toStartWith("Not sent");
    expect(h.log).toEqual(['key "rm " 90x30']);
    expect(h.refused).toEqual([
      "Not sent: World could not type into this terminal",
    ]);
  });

  test("the size is read when a key is typed", async () => {
    const h = harness();
    void h.typing.type("a");
    await h.settle();
    h.size.cols = 40;
    h.size.rows = 12;
    void h.typing.type("b");
    await h.answer();
    expect(h.log[1]).toBe('key "b" 40x12');
    expect(h.changes).toEqual(["90x30", "40x12"]);
  });

  test("a paste larger than one request goes in order, in pieces", async () => {
    const h = harness();
    const done = h.typing.type("é".repeat(CORE_INPUT_CHUNK));
    await h.settle();
    let joined = "";
    const bytes: number[] = [];
    while (h.log.length > bytes.length) {
      bytes.push(0);
      await h.answer();
    }
    await done;
    expect(h.log.length).toBe(2);
    for (const line of h.log) joined += JSON.parse(line.split(" ")[1]!);
    // Pieces split bytes, not characters; the program decodes the stream.
    expect(joined.replace(/�/g, "").length).toBeGreaterThan(
      CORE_INPUT_CHUNK - 2,
    );
  });

  test("focus away for a while, or no key for a minute, gives the size back", async () => {
    const h = harness();
    void h.typing.type("a");
    await h.answer();
    const [idle] = [...h.timers.keys()];
    h.typing.focus(false);
    h.typing.focus(true);
    expect(h.timers.size).toBe(1);
    h.typing.focus(false);
    const blur = [...h.timers.keys()].find((key) => key !== idle)!;
    h.fire(blur);
    await h.settle();
    expect(h.log).toEqual(['key "a" 90x30', "leave"]);
    void h.typing.type("b");
    await h.answer();
    const later = [...h.timers.keys()].pop()!;
    h.fire(later);
    await h.settle();
    expect(h.log).toEqual(['key "a" 90x30', "leave", 'key "b" 90x30', "leave"]);
  });

  test("closing stops everything queued without sending it", async () => {
    const h = harness();
    void h.typing.type("a");
    const queued = h.typing.type("b").catch((error: Error) => error.message);
    await h.settle();
    h.typing.stop();
    expect(await queued).toContain("closed");
    await h.answer();
    expect(h.log).toEqual(['key "a" 90x30']);
    expect(h.refused).toEqual([]);
    await h.typing.type("c");
    expect(h.log).toHaveLength(1);
  });
});

describe("the page's typing helpers", () => {
  test("only xterm's bare focus reports are dropped", () => {
    expect(isFocusReport("\x1b[I")).toBe(true);
    expect(isFocusReport("\x1b[O")).toBe(true);
    expect(isFocusReport("\x1b[I\x1b[O")).toBe(false);
    expect(isFocusReport("I")).toBe(false);
  });

  test("the fitted grid follows the view at actual size", () => {
    // 90x30 drawn at 9x18 px per cell.
    const drawn = { width: 810, height: 540 };
    expect(
      fittedGrid({ cols: 90, rows: 30 }, drawn, { width: 360, height: 400 }),
    ).toEqual({ cols: 40, rows: 22 });
    expect(
      fittedGrid(
        { cols: 90, rows: 30 },
        { width: 0, height: 0 },
        {
          width: 360,
          height: 400,
        },
      ),
    ).toEqual({ cols: 90, rows: 30 });
    expect(
      fittedGrid({ cols: 90, rows: 30 }, drawn, { width: 1, height: 1 }),
    ).toEqual({ cols: 2, rows: 2 });
  });

  test("without xterm's user-input event the view cannot type", () => {
    expect(userInputSignal({})).toBeNull();
    let fire = () => {};
    const signal = userInputSignal({
      _core: {
        coreService: {
          onUserInput(listener: () => void) {
            fire = listener;
            return { dispose() {} };
          },
        },
      },
    })!;
    expect(signal.take()).toBe(false);
    fire();
    expect(signal.take()).toBe(true);
    expect(signal.take()).toBe(false);
  });
});
