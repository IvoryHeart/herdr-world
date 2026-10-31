import { writeSync } from "node:fs";
import { join } from "node:path";
import { openWorldWriter } from "../world-writer";
import { openWorldLedger } from "../world-storage";
import { systemClock, systemScheduler } from "../../service/ports";

const [root, phase] = process.argv.slice(2);
if (!root || !phase)
  throw new Error("profile crash fixture requires root and phase");
const paths = {
  database: join(root, "world.sqlite"),
  ledger: join(root, "ledger.json"),
  profiles: join(root, "agent-profiles.json"),
};
const stopAt = (stage: string) => {
  writeSync(1, `${stage}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("crash guard unexpectedly resumed");
};
if (phase.startsWith("import-")) {
  openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    paths.profiles,
    (stage) => {
      if (`import-${stage}` === phase) stopAt(phase);
    },
  );
} else if (phase === "worker-ack" || phase === "worker-drain") {
  const store = await openWorldLedger(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  const profile = store.profiles.profile("builder")!;
  if (phase === "worker-ack") {
    await store.profiles.save({ ...profile, role: "Committed synthetic role" });
    await store.profiles.saveChimes({
      ...store.profiles.get().chimes,
      motifs: { needs_you: true, for_you: false, finished: true },
    });
    await store.profiles.rememberMaster(321);
    await store.profiles.finishSettingsImport("studio");
    stopAt("worker-ack");
  } else {
    const writes = Array.from({ length: 33 }, (_, index) =>
      store.profiles.save({ ...profile, name: `Synthetic ${index}` }),
    );
    const closing = store.close();
    await Promise.all(writes);
    await closing;
    writeSync(1, "worker-drain\n");
  }
} else {
  const writer = openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    paths.profiles,
  );
  const before = writer.read().profiles!;
  writer.batch(
    [
      {
        ticket: 1,
        request: {
          type: "profiles",
          operation: {
            type: "save",
            profile: {
              ...before.profiles.find((profile) => profile.id === "builder")!,
              role: "Committed synthetic role",
            },
          },
        },
      },
      {
        ticket: 2,
        request: {
          type: "profiles",
          operation: {
            type: "chimes",
            chimes: {
              ...before.chimes,
              motifs: { needs_you: true, for_you: false, finished: true },
            },
          },
        },
      },
      {
        ticket: 3,
        request: {
          type: "profiles",
          operation: { type: "remember-master", revision: 321 },
        },
      },
      {
        ticket: 4,
        request: {
          type: "profiles",
          operation: { type: "finish-import", connectionId: "studio" },
        },
      },
    ],
    1000,
    (stage) => {
      if (stage === phase) stopAt(stage);
    },
  );
  writer.close();
}
