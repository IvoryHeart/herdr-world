// Loaded by `bun test` (bunfig.toml). A run through scripts/run-tests.ts
// already has its own TMPDIR; a direct `bun test` gets one here, so test and
// Chrome scratch files never pile up in the shared temporary directory.
// `bun test` does not emit "exit", so a global afterAll removes it.
import { afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptRunTemp } from "./test-temp";

const run = adoptRunTemp();
if (run) afterAll(run.cleanup);
// Never the user's World data: a World server or store a test starts without
// its own folder uses this one, under the run's TMPDIR (instance-lock.ts).
process.env.HERDR_WORLD_DATA_DIR = join(tmpdir(), "herdr-world-data");

// Bun.spawn without `env` passes the environment Bun started with, not
// process.env, so a child would miss the settings above; give it them.
type SpawnOptions = { env?: Record<string, string | undefined> } | undefined;
const withEnv = <T extends SpawnOptions>(options: T) =>
  options?.env ? options : { ...options, env: process.env };
const { spawn, spawnSync } = Bun;
Object.assign(Bun, {
  spawn: ((command: unknown, options?: SpawnOptions) =>
    Array.isArray(command)
      ? spawn(command, withEnv(options) as never)
      : spawn(withEnv(command as SpawnOptions) as never)) as typeof Bun.spawn,
  spawnSync: ((command: unknown, options?: SpawnOptions) =>
    Array.isArray(command)
      ? spawnSync(command, withEnv(options) as never)
      : spawnSync(
          withEnv(command as SpawnOptions) as never,
        )) as typeof Bun.spawnSync,
});
