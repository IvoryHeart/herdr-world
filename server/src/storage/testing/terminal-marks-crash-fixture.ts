import { writeSync } from "node:fs";
import { join } from "node:path";
import { openWorldWriter } from "../world-writer";
import { openWorldLedger } from "../world-storage";
import { systemClock, systemScheduler } from "../../service/ports";
import { terminalMarkInput } from "./terminal-mark-input";

const [root, phase] = process.argv.slice(2);
if (!root || !phase)
  throw new Error("terminal marks fixture requires root and phase");
const paths = {
  database: join(root, "world.sqlite"),
  ledger: join(root, "ledger.json"),
};
function stopAt() {
  writeSync(1, `${phase}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("crash guard resumed");
}
const kinds = ["desk", "watchlist", "completion-seen"] as const;
if (phase === "worker-ack" || phase === "worker-drain") {
  const store = await openWorldLedger(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  const writes = kinds.map((kind) =>
    store.terminalMarks.put(terminalMarkInput(kind)),
  );
  if (phase === "worker-ack") {
    await Promise.all(writes);
    stopAt();
  } else {
    const close = store.close();
    await Promise.all(writes);
    await close;
    writeSync(1, `${phase}\n`);
  }
} else {
  const writer = openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
  );
  writer.batch(
    kinds.map((kind, ticket) => ({
      ticket,
      request: {
        type: "terminal-mark" as const,
        operation: { type: "put" as const, input: terminalMarkInput(kind) },
      },
    })),
    1000,
    (stage) => {
      if (stage === phase) stopAt();
    },
  );
  writer.close();
}
