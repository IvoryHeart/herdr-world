// Loaded by `bun test` (bunfig.toml). A run through scripts/run-tests.ts
// already has its own TMPDIR; a direct `bun test` gets one here, so test and
// Chrome scratch files never pile up in the shared temporary directory.
// `bun test` does not emit "exit", so a global afterAll removes it.
import { afterAll } from "bun:test";
import { adoptRunTemp } from "./test-temp";

const run = adoptRunTemp();
if (run) afterAll(run.cleanup);
