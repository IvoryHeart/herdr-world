import { afterEach, expect, test } from "bun:test";
import { TEST_TIMINGS } from "./testing/timings";
import {
  PRODUCTION_TIMINGS,
  setTimingsForTests,
  TIMING_FLOORS,
  TIMING_ORDER,
  timing,
  type TimingName,
} from "./timings";

afterEach(() => setTimingsForTests(null));

const names = Object.keys(PRODUCTION_TIMINGS) as TimingName[];

test("the test set names every product timer and nothing else", () => {
  expect(Object.keys(TEST_TIMINGS).sort()).toEqual([...names].sort());
});

test("every test timing is a single-digit millisecond count or its library floor", () => {
  for (const name of names) {
    const value = TEST_TIMINGS[name];
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    const floor = TIMING_FLOORS[name];
    if (floor === undefined) expect(value).toBeLessThan(10);
    else expect(value).toBe(floor);
  }
});

test("both sets keep every declared order", () => {
  expect(TIMING_ORDER.length).toBeGreaterThan(0);
  for (const set of [PRODUCTION_TIMINGS, TEST_TIMINGS])
    for (const [shorter, longer] of TIMING_ORDER)
      expect(set[shorter]).toBeLessThan(set[longer]);
});

test("timers read production values until test code switches the set", () => {
  for (const name of names) expect(timing(name)).toBe(PRODUCTION_TIMINGS[name]);
  setTimingsForTests(TEST_TIMINGS);
  for (const name of names) expect(timing(name)).toBe(TEST_TIMINGS[name]);
  setTimingsForTests(null);
  expect(timing("askPeerPollMs")).toBe(5_000);
});
