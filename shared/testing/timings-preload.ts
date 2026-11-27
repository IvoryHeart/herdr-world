/**
 * `bun --preload` for a World or bridge process a test launches: its product
 * timers run on the test set (#1419). Only test launchers pass it.
 */
import { setTimingsForTests } from "../timings";
import { TEST_TIMINGS } from "./test-timings";

setTimingsForTests(TEST_TIMINGS);
