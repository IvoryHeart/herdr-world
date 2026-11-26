import { afterAll, beforeAll } from "bun:test";
import { setTimingsForTests } from "../timings";
import { TEST_TIMINGS } from "./test-timings";

export { TEST_TIMINGS };

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
