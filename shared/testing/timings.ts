import { afterAll, beforeAll } from "bun:test";
import { setTimingsForTests, type Timings } from "../timings";

/**
 * The test timing set (#1419): the real product timers, each a few
 * milliseconds, keeping every order in `TIMING_ORDER`.
 */
export const TEST_TIMINGS: Timings = {
  askPeerPollMs: 3,
  askPeerGraceMs: 9,
  registryBusyWaitMs: 5,
  creationPreparationMs: 5,
};

/** Runs this test file's product timers on the test set. */
export function useTestTimings() {
  beforeAll(() => setTimingsForTests(TEST_TIMINGS));
  afterAll(() => setTimingsForTests(null));
}

/**
 * Runs one test body on the test set: for a file whose other cases wait on
 * real work a few-millisecond deadline could cut short.
 */
export async function withTestTimings<T>(body: () => Promise<T>): Promise<T> {
  setTimingsForTests(TEST_TIMINGS);
  try {
    return await body();
  } finally {
    setTimingsForTests(null);
  }
}
