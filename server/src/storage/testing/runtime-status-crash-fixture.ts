import { writeSync } from "node:fs";
import { join } from "node:path";
import { openWorldWriter } from "../world-writer";
import { openWorldLedger } from "../world-storage";
import { systemClock, systemScheduler } from "../../service/ports";
const [root, phase] = process.argv.slice(2);
if (!root || !phase)
  throw new Error("runtime status fixture requires root/phase");
const paths = {
  database: join(root, "world.sqlite"),
  ledger: join(root, "ledger.json"),
  settings: join(root, "settings.json"),
};
const status = {
  last_run_at: "2026-10-01T00:00:00.000Z",
  last_status: "updated" as const,
  last_message: "Synthetic committed run",
  last_branch: "feature/synthetic",
};
const a = "connection:alpha:local:/synthetic/repo",
  b = "connection:beta:local:/synthetic/repo";
function stopAt(stage: string) {
  writeSync(1, `${stage}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("crash guard resumed");
}
if (phase.startsWith("import-")) {
  openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    undefined,
    undefined,
    {
      path: paths.settings,
      fault: (stage) => {
        if (`import-${stage}` === phase) stopAt(phase);
      },
    },
  );
} else if (phase === "worker-ack" || phase === "worker-drain") {
  const store = await openWorldLedger(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  if (phase === "worker-ack") {
    await Promise.all([
      store.runtimeStatus.put(a, status),
      store.runtimeStatus.put(b, { ...status, last_status: "failed" }),
    ]);
    stopAt(phase);
  } else {
    const writes = Array.from({ length: 33 }, (_, i) =>
      store.runtimeStatus.put(a, { ...status, last_message: `Synthetic ${i}` }),
    );
    const closing = store.close();
    await Promise.all(writes);
    await closing;
    writeSync(1, `${phase}\n`);
  }
} else {
  const writer = openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    undefined,
    undefined,
    { path: paths.settings },
  );
  writer.batch(
    [
      { ticket: 1, request: { type: "runtime-status", key: a, status } },
      {
        ticket: 2,
        request: {
          type: "runtime-status",
          key: b,
          status: { ...status, last_status: "failed" },
        },
      },
    ],
    1000,
    (stage) => {
      if (stage === phase) stopAt(phase);
    },
  );
  writer.close();
}
