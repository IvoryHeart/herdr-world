import { describe, expect, test } from "bun:test";
import { createFrameLoop, type FrameRegistrar } from "./boardScheduler";

/**
 * A fake World frame scheduler: frames run only when the test flushes, and
 * motion frames are held back while `typing` is on, as World holds them while
 * a terminal receives input.
 */
function fakeScheduler() {
  let draw: ((now: number) => void) | null = null;
  let pending: "state" | "motion" | null = null;
  let disposed = false;
  let time = 0;
  const scheduler = {
    typing: false,
    kinds: [] as string[],
    register: ((_element, d) => {
      draw = d;
      return {
        request(kind = "state") {
          if (disposed) return;
          scheduler.kinds.push(kind);
          if (pending !== "state") pending = kind;
        },
        dispose() {
          disposed = true;
          pending = null;
        },
      };
    }) as FrameRegistrar,
    /** Run the pending frame, if the scheduler would; returns whether it ran. */
    flush() {
      if (!pending || !draw) return false;
      if (pending === "motion" && scheduler.typing) return false;
      pending = null;
      time += 16;
      draw(time);
      return true;
    },
    pending: () => pending,
    disposed: () => disposed,
  };
  return scheduler;
}
const element = {} as Element;

describe("Board frame loop on World's scheduler", () => {
  test("frames run only when invalidated, as state frames, with the reasons collected", () => {
    const frames = fakeScheduler();
    const seen: string[][] = [];
    const loop = createFrameLoop({
      element,
      frame: (_dt, reasons) => (seen.push([...reasons]), false),
      onError: () => {},
      register: frames.register,
    });
    expect(frames.flush()).toBe(false);
    loop.invalidate("camera");
    loop.invalidate("model");
    expect(frames.pending()).toBe("state");
    frames.flush();
    expect(seen).toEqual([["camera", "model"]]);
    // Nothing moving: the loop stops.
    expect(loop.running()).toBe(false);
    expect(frames.pending()).toBe(null);
  });

  test("the loop keeps going as motion while something moves", () => {
    const frames = fakeScheduler();
    let moving = 3;
    const loop = createFrameLoop({
      element,
      frame: () => --moving > 0,
      onError: () => {},
      register: frames.register,
    });
    loop.invalidate("drop");
    let count = 0;
    while (frames.flush()) count++;
    expect(count).toBe(3);
    expect(frames.kinds).toEqual(["state", "motion", "motion"]);
  });

  test("settling pauses while the user types, and a drag keeps going", () => {
    const frames = fakeScheduler();
    let ran = 0;
    const loop = createFrameLoop({
      element,
      frame: () => (ran++, true),
      onError: () => {},
      register: frames.register,
    });
    frames.typing = true;
    // A drag invalidates on every pointer move: state frames still run.
    for (let i = 0; i < 3; i++) {
      loop.invalidate("drag");
      expect(frames.flush()).toBe(true);
    }
    expect(ran).toBe(3);
    // The drop: no more invalidations, so only motion is left, and it waits
    // for typing to stop.
    expect(frames.flush()).toBe(false);
    expect(frames.pending()).toBe("motion");
    frames.typing = false;
    expect(frames.flush()).toBe(true);
    expect(ran).toBe(4);
  });

  test("an error in one frame is reported and later frames still run", () => {
    const frames = fakeScheduler();
    const errors: unknown[] = [];
    let calls = 0;
    const loop = createFrameLoop({
      element,
      frame: () => {
        calls++;
        if (calls === 1) throw new Error("bad frame");
        return false;
      },
      onError: (error) => errors.push(error),
      register: frames.register,
    });
    loop.invalidate("a");
    frames.flush();
    loop.invalidate("b");
    frames.flush();
    expect(errors).toHaveLength(1);
    expect(calls).toBe(2);
  });

  test("invalidating during a frame asks for another state frame", () => {
    const frames = fakeScheduler();
    let first = true;
    const loop = createFrameLoop({
      element,
      frame: () => {
        if (first) {
          first = false;
          loop.invalidate("again");
        }
        return false;
      },
      onError: () => {},
      register: frames.register,
    });
    loop.invalidate("start");
    frames.flush();
    expect(frames.pending()).toBe("state");
  });

  test("stopping leaves the scheduler", () => {
    const frames = fakeScheduler();
    const loop = createFrameLoop({
      element,
      frame: () => true,
      onError: () => {},
      register: frames.register,
    });
    loop.invalidate("mount");
    loop.stop();
    expect(frames.disposed()).toBe(true);
    loop.invalidate("late");
    expect(frames.flush()).toBe(false);
  });
});
