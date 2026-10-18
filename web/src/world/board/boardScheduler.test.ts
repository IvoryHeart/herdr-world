import { describe, expect, test } from "bun:test";
import { createFrameLoop } from "./boardScheduler";
import { createTrace, traceRequested } from "./boardTrace";

/** A fake animation-frame clock: frames run only when the test flushes. */
function fakeFrames() {
  let queue: ((t: number) => void)[] = [];
  let time = 0;
  return {
    request: (cb: (t: number) => void) => {
      queue.push(cb);
      return queue.length;
    },
    cancel: () => {
      queue = [];
    },
    flush() {
      time += 16;
      const run = queue;
      queue = [];
      for (const cb of run) cb(time);
      return run.length;
    },
    pending: () => queue.length,
  };
}

describe("Board frame loop", () => {
  test("frames run only when invalidated, with the reasons collected", () => {
    const frames = fakeFrames();
    const seen: string[][] = [];
    const loop = createFrameLoop({
      frame: (_dt, reasons) => (seen.push([...reasons]), false),
      onError: () => {},
      ...frames,
    });
    expect(frames.flush()).toBe(0);
    loop.invalidate("camera");
    loop.invalidate("model");
    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(seen).toEqual([["camera", "model"]]);
    // Nothing moving: the loop stops.
    expect(loop.running()).toBe(false);
  });

  test("the loop keeps going while something moves", () => {
    const frames = fakeFrames();
    let moving = 3;
    const loop = createFrameLoop({
      frame: () => --moving > 0,
      onError: () => {},
      ...frames,
    });
    loop.invalidate("drag");
    let count = 0;
    while (frames.flush()) count++;
    expect(count).toBe(3);
  });

  test("an error in one frame is reported and later frames still run", () => {
    const frames = fakeFrames();
    const errors: unknown[] = [];
    let calls = 0;
    const loop = createFrameLoop({
      frame: () => {
        calls++;
        if (calls === 1) throw new Error("bad frame");
        return false;
      },
      onError: (error) => errors.push(error),
      ...frames,
    });
    loop.invalidate("a");
    frames.flush();
    loop.invalidate("b");
    frames.flush();
    expect(errors).toHaveLength(1);
    expect(calls).toBe(2);
  });

  test("invalidating during a frame schedules another", () => {
    const frames = fakeFrames();
    let first = true;
    const loop = createFrameLoop({
      frame: () => {
        if (first) {
          first = false;
          loop.invalidate("again");
        }
        return false;
      },
      onError: () => {},
      ...frames,
    });
    loop.invalidate("start");
    frames.flush();
    expect(frames.pending()).toBe(1);
  });
});

describe("Board trace", () => {
  test("records only when enabled, keeps the newest entries, and exports them", () => {
    let t = 0;
    const trace = createTrace(3, () => (t += 5));
    trace.record("ignored");
    expect(trace.entries()).toEqual([]);
    trace.enabled = true;
    for (const kind of ["a", "b", "c", "d"]) trace.record(kind, { n: kind });
    expect(trace.entries().map((e) => e.kind)).toEqual(["b", "c", "d"]);
    expect(JSON.parse(trace.export({ view: "board" }))).toMatchObject({
      version: 1,
      context: { view: "board" },
    });
  });

  test("tracing starts from the URL or a saved choice", () => {
    expect(traceRequested("?debug=board", null)).toBe(true);
    expect(traceRequested("", "on")).toBe(true);
    expect(traceRequested("?debug=town", "off")).toBe(false);
  });
});
