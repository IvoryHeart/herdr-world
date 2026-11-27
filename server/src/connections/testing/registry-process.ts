/** Subprocess consumer: synthetic files, actual CLI/startup, never a listener. */
import { readSync } from "node:fs";
import { join } from "node:path";
import type { CliContext } from "../../cli/command";
import { createConnectionsCommand } from "../../cli/connections";
import { runCli } from "../../cli/index";
import { resolveDataPaths } from "../../config/data-paths";
import {
  herdrAdapter,
  systemClock,
  systemScheduler,
} from "../../service/ports";
import { openStorage } from "../../service/storage";
import { testServerConfig } from "../../service/testing/services";
import { createWorldService } from "../../service/world-service";
import { ConnectionProfileStore } from "../profiles";
import { TEST_TIMINGS } from "../../../../shared/testing/test-timings";
import { setTimingsForTests } from "../../../../shared/timings";

const options = JSON.parse(process.argv[2]) as {
  root: string;
  home: string;
  mode: "edit" | "startup";
  args?: string[];
  hold?: string;
  ownerRoot?: string;
  /** Run this process's timers on the test set (a contender's wait expires at once). */
  testTimings?: boolean;
};
if (options.testTimings) setTimingsForTests(TEST_TIMINGS);
function event(name: string, data?: unknown) {
  console.log(`@@${JSON.stringify({ name, data })}`);
  if (options.hold === name) {
    options.hold = undefined;
    const input = Buffer.alloc(1);
    if (readSync(0, input, 0, 1, null) !== 1)
      throw new Error("fixture gate closed");
  }
}
const prototype = ConnectionProfileStore.prototype;
const load = prototype.load;
prototype.load = function () {
  const snapshot = load.call(this);
  event("snapshot", snapshot?.profiles.map((p) => p.id) ?? []);
  return snapshot;
};
const save = prototype.save;
prototype.save = function (registry) {
  event(
    "save",
    registry.profiles.map((p) => p.id),
  );
  return save.call(this, registry);
};
const acquire = prototype.acquireServiceOwnership;
prototype.acquireServiceOwnership = async function () {
  event("service-attempt");
  await acquire.call(this);
  event("service-owned");
};

if (options.mode === "startup") {
  const ownerRoot = options.ownerRoot ?? options.root;
  const service = await createWorldService({
    config: testServerConfig(ownerRoot, {
      hasExplicitSocketPath: false,
      hasExplicitClientSocketPath: false,
    }),
    paths: resolveDataPaths({
      HERDR_WORLD_DATA_DIR: ownerRoot,
      HERDR_WORLD_CONNECTIONS_PATH: join(options.root, "connections.json"),
    }),
    clock: systemClock,
    scheduler: systemScheduler,
    storage: openStorage,
    adapters: { herdr: herdrAdapter },
    scheduleProcessExit() {},
  });
  event(
    "bootstrapped",
    service.storage.connections.load()?.profiles.map((p) => p.id) ?? [],
  );
  await service.stop();
  event("closed");
} else {
  const context: CliContext = {
    version: "0.0.0-test",
    runtime: {
      platform: "linux",
      arch: "x64",
      homeDir: options.home,
      execPath: process.execPath,
      argv: [process.execPath],
      uid: 1000,
      env: { HERDR_WORLD_DATA_DIR: options.root },
    },
    runCommand: () => 4,
    captureCommand: () => ({ code: 4, stdout: "" }),
    log: (text) => event("log", text),
    error: (text) => event("error", text),
  };
  event("cli-attempt");
  const code = await runCli(["connections", ...options.args!], context, [
    createConnectionsCommand({
      probe: async () => false,
      herdrInstalled: async () => true,
    }),
  ]);
  event("receipt", code);
  process.exitCode = code;
}
