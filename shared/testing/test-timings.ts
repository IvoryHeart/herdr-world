import type { Timings } from "../timings";

/**
 * The test timing set (#1419): the real product timers, each a few
 * milliseconds (or a library's floor, `TIMING_FLOORS`), keeping every order
 * in `TIMING_ORDER`.
 */
export const TEST_TIMINGS: Timings = {
  askPeerPollMs: 3,
  askPeerGraceMs: 9,
  registryBusyWaitMs: 5,
  durableLockRetryMs: 2,
  durableLockRenewMs: 1_000,
  durableLockStaleMs: 2_000,
  durableLockWaitMs: 2_500,
  creationPreparationMs: 5,
};
