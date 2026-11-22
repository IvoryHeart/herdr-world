import { afterEach, expect, test } from "bun:test";
import type { FocusState } from "../../../shared/focus";
import {
  admitFocus,
  focusHeld,
  focusLeftText,
  focusNow,
  focusRecapSession,
  focusRemaining,
  resetFocusForTests,
  shouldChimeFocusEnd,
  RECAP_MS,
} from "./focus";

const MIN = 60_000;
const T = 1_800_000_000_000;
const running = (ends_at: number | null, revision = 3): FocusState => ({
  revision,
  now: T,
  session: { id: "focus-b", started_at: T - 10 * MIN, ends_at },
  last: null,
});
const ended = (reason: "expired" | "ended", ended_at = T): FocusState => ({
  revision: 4,
  now: T,
  session: null,
  last: {
    id: "focus-a",
    started_at: T - 45 * MIN,
    ends_at: T,
    ended_at,
    reason,
  },
});

afterEach(() => resetFocusForTests());

test("a session holds until its end time; open-ended until ended", () => {
  expect(focusHeld(null, T)).toBe(false);
  expect(focusHeld(running(T + 5 * MIN), T)).toBe(true);
  expect(focusHeld(running(T + 5 * MIN), T + 5 * MIN)).toBe(false);
  expect(focusHeld(running(null), T + 600 * MIN)).toBe(true);
  expect(focusRemaining(running(T + 5 * MIN), T)).toBe(5 * MIN);
  expect(focusRemaining(running(null), T)).toBeNull();
  expect(focusLeftText(running(T + 18 * MIN), T)).toBe("18 m left");
  expect(focusLeftText(running(null), T)).toBe("Until you stop");
  expect(focusLeftText(ended("expired"), T)).toBeNull();
});

test("the end chimes once per device, only for a session that reached its time and only near its end", () => {
  const last = ended("expired").last;
  expect(shouldChimeFocusEnd(last, T + 1_000, null)).toBe(true);
  // Already chimed here (another tab claimed it).
  expect(shouldChimeFocusEnd(last, T + 1_000, "focus-a")).toBe(false);
  // End now was a choice, not news.
  expect(shouldChimeFocusEnd(ended("ended").last, T + 1_000, null)).toBe(false);
  // A page opened long after stays quiet.
  expect(shouldChimeFocusEnd(last, T + 10 * MIN, null)).toBe(false);
  expect(shouldChimeFocusEnd(null, T, null)).toBe(false);
});

test("the recap shows after the end until cleared or stale, never during a session", () => {
  const state = ended("ended");
  expect(focusRecapSession(state, T + MIN, null)?.id).toBe("focus-a");
  expect(focusRecapSession(state, T + MIN, "focus-a")).toBeNull();
  expect(focusRecapSession(state, T + RECAP_MS + 1, null)).toBeNull();
  const again = { ...running(T + 25 * MIN), last: state.last };
  expect(focusRecapSession(again, T + MIN, null)).toBeNull();
});

test("an older reply never replaces a newer state", () => {
  admitFocus(running(T + 25 * MIN, 5), T);
  admitFocus(ended("ended"), T);
  expect(focusHeld(undefined, T)).toBe(true);
  admitFocus({ ...ended("ended"), revision: 6 }, T);
  expect(focusHeld(undefined, T)).toBe(false);
  // Malformed replies are ignored.
  admitFocus({ revision: -1 }, T);
  expect(focusHeld(undefined, T)).toBe(false);
});

test("the time left counts by the service's clock, not a skewed device's", () => {
  // The service answered with its clock at T; this device's clock differs.
  admitFocus(running(T + 5 * MIN), Date.now());
  expect(Math.abs(focusNow() - T)).toBeLessThan(1_000);
  expect(focusRemaining()).toBeGreaterThan(5 * MIN - 1_000);
  expect(focusRemaining()).toBeLessThanOrEqual(5 * MIN);
});
