import { describe, expect, test } from "bun:test";
import { installTestClock, type ClockTarget } from "./testClock";

function clockOnObject() {
  const target = {} as ClockTarget;
  const time = { now: () => 0 };
  return { target, clock: installTestClock(target, time), time };
}

describe("test clock", () => {
  test("a timer's promise continuations run before the next timer, as natively (review)", async () => {
    // Natively: two zero-delay timers are separate tasks, so the first one's
    // awaited continuation completes before the second reads it.
    const native: boolean[] = [];
    await new Promise<void>((resolve) => {
      let complete = false;
      setTimeout(async () => {
        await Promise.resolve();
        await Promise.resolve();
        complete = true;
      }, 0);
      setTimeout(() => {
        native.push(complete);
        resolve();
      }, 0);
    });
    const { target, clock } = clockOnObject();
    const simulated: boolean[] = [];
    let complete = false;
    target.setTimeout(async () => {
      await Promise.resolve();
      await Promise.resolve();
      complete = true;
    }, 0);
    target.setTimeout(() => simulated.push(complete), 0);
    await clock.advance(16);
    expect(simulated).toEqual(native);
    expect(simulated).toEqual([true]);
  });

  test("a frame callback's continuations run before the next frame callback", async () => {
    const { target, clock } = clockOnObject();
    const seen: boolean[] = [];
    let complete = false;
    target.requestAnimationFrame(async () => {
      await Promise.resolve();
      complete = true;
    });
    target.requestAnimationFrame(() => seen.push(complete));
    await clock.advance(16);
    expect(seen).toEqual([true]);
  });

  test.each([false, true])(
    "a frame callback can cancel a later callback in the same frame (continuation: %s)",
    async (continuation) => {
      const { target, clock } = clockOnObject();
      const seen: string[] = [];
      target.requestAnimationFrame(async () => {
        seen.push("dispose");
        if (continuation) await Promise.resolve();
        target.cancelAnimationFrame(cancelled);
        target.requestAnimationFrame(() => seen.push("next frame"));
      });
      const cancelled = target.requestAnimationFrame(() =>
        seen.push("disposed callback"),
      );
      target.requestAnimationFrame(() => seen.push("still mounted"));
      await clock.advance(16);
      expect(seen).toEqual(["dispose", "still mounted"]);
      await clock.advance(16);
      expect(seen).toEqual(["dispose", "still mounted", "next frame"]);
    },
  );

  test("a callback that throws is reported, and the clock keeps going", async () => {
    const reported: unknown[] = [];
    const original = globalThis.reportError;
    globalThis.reportError = (error) => reported.push(error);
    try {
      const { target, clock } = clockOnObject();
      const later: string[] = [];
      target.setTimeout(() => {
        throw new Error("timer");
      }, 0);
      target.requestAnimationFrame(() => {
        throw new Error("frame");
      });
      target.setTimeout(() => later.push("timer after"), 20);
      target.requestAnimationFrame(() => later.push("frame after"));
      await clock.advance(48);
      expect(reported.map((error) => (error as Error).message)).toEqual([
        "timer",
        "frame",
      ]);
      expect(later).toEqual(["frame after", "timer after"]);
    } finally {
      globalThis.reportError = original;
    }
  });

  test("the running clock rests when idle, yet advances, deadlines and work move it", async () => {
    const target = {} as ClockTarget;
    const time = { now: () => 0 };
    const clock = installTestClock(target, time, { running: true });
    const start = time.now();
    // Nothing scheduled: the driver rests, and an advance still moves time.
    await clock.advance(100);
    expect(time.now() - start).toBeGreaterThanOrEqual(100);
    await expect(clock.until(() => false, "deadline", 200)).rejects.toThrow(
      "deadline",
    );
    // Work wakes it: a timer fires without the test advancing time.
    let fired = false;
    target.setTimeout(() => {
      fired = true;
    }, 50);
    await clock.until(() => fired, "the timer did not fire", 1000);
    expect(fired).toBe(true);
    // Going to rest while an advance waits does not stall that advance.
    for (let i = 0; i < 20; i++) {
      target.setTimeout(() => {}, i);
      await clock.advance(16);
    }
  });

  test("on the running clock, a frame wait returns only after its frames have drawn (review)", async () => {
    const target = {} as ClockTarget;
    const clock = installTestClock(target, { now: () => 0 }, { running: true });
    // A timer keeps the driver busy, so frame() waits on its steps.
    const interval = target.setInterval(() => {}, 1);
    const seen: string[] = [];
    target.requestAnimationFrame(() => {
      seen.push("first");
      target.requestAnimationFrame(() => seen.push("second"));
    });
    await clock.frame();
    expect(seen).toEqual(["first", "second"]);
    // A deadline at the same time as the work does not expire before it.
    const later: string[] = [];
    target.requestAnimationFrame(() => {
      later.push("first");
      target.requestAnimationFrame(() => later.push("second"));
    });
    await clock.until(() => later.length === 2, "deadline", 32);
    target.clearInterval(interval);
  });

  test("on the running clock, an advance returns only after every callback due by then (review)", async () => {
    const target = {} as ClockTarget;
    const time = { now: () => 0 };
    const clock = installTestClock(target, time, { running: true });
    const events: number[] = [];
    target.setTimeout(() => {
      for (let i = 0; i < 20; i++) target.setTimeout(() => events.push(i), 16);
      target.requestAnimationFrame(() => {});
    }, 1);
    await Promise.resolve();
    await Promise.resolve();
    // They fall due at 32 ms: the advance ends on the step that runs them.
    await clock.advance(32);
    expect(events).toHaveLength(20);
    const more: number[] = [];
    target.setTimeout(() => {
      for (let i = 0; i < 20; i++) target.setTimeout(() => more.push(i), 16);
    }, 1);
    await clock.until(() => more.includes(19), "last due timer", 32);
    expect(more).toHaveLength(20);
  });

  test("a wait started during a step counts from then, not from the last finished step (review)", async () => {
    // advance: twenty timers due exactly at its end all run before it returns.
    {
      const target = {} as ClockTarget;
      const clock = installTestClock(
        target,
        { now: () => 0 },
        { running: true },
      );
      const events: number[] = [];
      target.setTimeout(() => {}, 1);
      await Promise.resolve();
      await Promise.resolve(); // a step is under way
      for (let i = 0; i < 20; i++) target.setTimeout(() => events.push(i), 16);
      await clock.advance(16);
      expect(events).toHaveLength(20);
    }
    // until: a timer due exactly at its deadline is not a false timeout.
    {
      const target = {} as ClockTarget;
      const clock = installTestClock(
        target,
        { now: () => 0 },
        { running: true },
      );
      const interval = target.setInterval(() => {}, 1);
      await Promise.resolve();
      await Promise.resolve();
      let done = false;
      target.setTimeout(() => {
        done = true;
      }, 16);
      await clock.until(() => done, "deadline", 16);
      expect(done).toBe(true);
      target.clearInterval(interval);
    }
  });

  test("scheduler.postTask runs on test time, with its delay", async () => {
    const target = {
      scheduler: { postTask: () => Promise.reject(new Error("real")) },
    } as unknown as ClockTarget;
    const clock = installTestClock(target, { now: () => 0 });
    const scheduler = (
      target as unknown as {
        scheduler: {
          postTask<T>(task: () => T, options?: { delay?: number }): Promise<T>;
        };
      }
    ).scheduler;
    const order: string[] = [];
    void scheduler.postTask(() => order.push("later"), { delay: 40 });
    const soon = scheduler.postTask(() => {
      order.push("soon");
      return 7;
    });
    await clock.advance(16);
    expect(await soon).toBe(7);
    expect(order).toEqual(["soon"]);
    await clock.advance(32);
    expect(order).toEqual(["soon", "later"]);
  });

  test("time moves only when advanced, in frames, and timers fire in order", async () => {
    const { target, clock, time } = clockOnObject();
    const fired: string[] = [];
    target.setTimeout(() => fired.push(`b@${time.now()}`), 40);
    target.setTimeout(() => fired.push(`a@${time.now()}`), 10);
    const start = time.now();
    expect(fired).toEqual([]);
    await clock.advance(48);
    expect(fired).toEqual([`a@${start + 16}`, `b@${start + 48}`]);
    let frames = 0;
    const tick = () => {
      frames++;
      target.requestAnimationFrame(tick);
    };
    target.requestAnimationFrame(tick);
    await clock.advance(160);
    expect(frames).toBe(10);
    await expect(clock.until(() => false, "never", 100)).rejects.toThrow(
      "never",
    );
  });
});
