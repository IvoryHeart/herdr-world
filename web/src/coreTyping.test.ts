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
function harness(size = { cols: 90, rows: 30 }, opening = false) {
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
      hold: (grid) => {
        log.push(`hold ${grid.cols}x${grid.rows}`);
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
      opening,
    },
  );
  const flushTasks = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    typing,
    log,
    refused,
    changes,
    size,
    timers,
    flushTasks,
    async answer(error?: Error) {
      const request = pending.shift()!;
      if (error) request.reject(error);
      else request.resolve();
      await flushTasks();
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
    await h.flushTasks();
    expect(h.log).toEqual(['key "a" 90x30']);
    await h.answer();
    expect(h.log).toEqual(['key "a" 90x30', 'key "bc" 90x30']);
  });

  test("replies keep their place between keys (the server sends them only after a key)", async () => {
    const h = harness();
    void h.typing.type("x");
    void h.typing.type("\x1b[2;2R", true);
    void h.typing.type("y");
    await h.flushTasks();
    await h.answer();
    await h.answer();
    await h.answer();
    expect(h.log).toEqual([
      'key "x" 90x30',
      'auto "\\u001b[2;2R" 90x30',
      'key "y" 90x30',
    ]);
  });

  test("the open view holds its size at once; later sizes settle first and go once", async () => {
    const h = harness();
    h.typing.hold({ cols: 90, rows: 30 });
    await h.flushTasks();
    expect(h.log).toEqual(["hold 90x30"]);
    // A drag: only the size it ends at is asked for.
    h.typing.hold({ cols: 80, rows: 30 });
    h.typing.hold({ cols: 70, rows: 28 });
    expect(h.timers.size).toBe(1);
    h.fire([...h.timers.keys()][0]!);
    await h.flushTasks();
    expect(h.log).toEqual(["hold 90x30", "hold 70x28"]);
    // The same size again sends nothing; there is no give-back on blur or idle.
    h.typing.hold({ cols: 70, rows: 28 });
    h.fire([...h.timers.keys()][0]!);
    await h.flushTasks();
    expect(h.log).toHaveLength(2);
    expect(h.changes).toEqual(["90x30", "70x28"]);
    h.typing.stop();
    expect(h.changes[h.changes.length - 1]).toBeNull();
    expect(h.timers.size).toBe(0);
  });

  test("a size waits for the keys before it; a hidden view (zero size) holds nothing", async () => {
    const h = harness();
    void h.typing.type("a");
    h.typing.hold({ cols: 90, rows: 30 });
    h.typing.hold({ cols: 0, rows: 0 });
    await h.flushTasks();
    expect(h.log).toEqual(['key "a" 90x30']);
    await h.answer();
    expect(h.log).toEqual(['key "a" 90x30', "hold 90x30"]);
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
    await h.flushTasks();
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
    await h.flushTasks();
    h.size.cols = 40;
    h.size.rows = 12;
    void h.typing.type("b");
    await h.answer();
    expect(h.log[1]).toBe('key "b" 40x12');
  });

  test("a paste larger than one request goes in order, in pieces", async () => {
    const h = harness();
    const done = h.typing.type("é".repeat(CORE_INPUT_CHUNK));
    await h.flushTasks();
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

  test("keys typed before the watch answers wait for it, then go once, in order", async () => {
    // Live core 0.1.21: the server knows the stream only once its observe
    // attach answered, so a key sent earlier was refused ("not being watched").
    const h = harness({ cols: 90, rows: 30 }, true);
    const first = h.typing.type("a");
    const second = h.typing.type("b");
    await h.flushTasks();
    expect(h.log).toEqual([]);
    h.typing.open();
    h.typing.open();
    await h.flushTasks();
    expect(h.log).toEqual(['key "ab" 90x30']);
    await h.answer();
    await Promise.all([first, second]);
    void h.typing.type("c");
    await h.flushTasks();
    expect(h.log).toEqual(['key "ab" 90x30', 'key "c" 90x30']);
    expect(h.refused).toEqual([]);
  });

  test("a watch that never opens drops the keys that waited, unsent", async () => {
    const h = harness({ cols: 90, rows: 30 }, true);
    const waiting = h.typing.type("a").catch((error: Error) => error.message);
    await h.flushTasks();
    h.typing.stop();
    expect(await waiting).toContain("closed");
    h.typing.open();
    await h.flushTasks();
    expect(h.log).toEqual([]);
    expect(h.refused).toEqual([]);
  });

  test("closing stops everything queued without sending it", async () => {
    const h = harness();
    void h.typing.type("a");
    const queued = h.typing.type("b").catch((error: Error) => error.message);
    await h.flushTasks();
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
