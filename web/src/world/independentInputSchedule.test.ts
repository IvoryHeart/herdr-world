import { expect, test } from "bun:test";
import { startIndependentInput } from "./independentInputSchedule";

test("a late producer preserves overdue intents without accumulating timer drift", () => {
  let now = 100;
  let callback: () => void = () => {};
  let delay = 0;
  let cancelled = false;
  const events: { sequence: number; dueAt: number; sentAt: number }[] = [];
  const stop = startIndependentInput((input) => events.push(input), {
    now: () => now,
    schedule: (next, ms) => {
      callback = next;
      delay = ms;
      return next;
    },
    cancel: () => {
      cancelled = true;
    },
  });
  expect(delay).toBe(5);
  now = 200;
  callback();
  expect(events).toEqual([{ sequence: 0, dueAt: 105, sentAt: 200 }]);
  expect(delay).toBe(0);
  callback();
  expect(events[1]).toEqual({ sequence: 1, dueAt: 180, sentAt: 200 });
  expect(delay).toBe(55);
  stop();
  callback();
  expect(events).toHaveLength(2);
  expect(cancelled).toBe(true);
});
