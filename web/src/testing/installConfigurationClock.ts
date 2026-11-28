import { installTestClock } from "../world/testing/testClock";

/**
 * The running test clock for the Settings fixture, without
 * `installRunningTestClock`'s CSS switch: this fixture asserts the real
 * transition durations and drawer animations of the product, which run on
 * real time while its timers and frames follow test time.
 */
export const clock = installTestClock(window, performance, { running: true });
window.__HERDR_TEST_CLOCK__ = clock;
