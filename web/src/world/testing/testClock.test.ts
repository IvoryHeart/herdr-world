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
