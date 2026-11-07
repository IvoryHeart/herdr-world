import { expect } from "bun:test";
import { systemClock, systemScheduler } from "../service/ports";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { createCrashFixture } from "./testing/crash-harness";
const harness = createCrashFixture({
  name: "terminal-marks",
  source: resolve(import.meta.dir, "testing/terminal-marks-crash-fixture.ts"),
  entry: resolve(import.meta.dir, "../testing/terminal-marks-crash-entry.ts"),
  worker: resolve(import.meta.dir, "world-worker.ts"),
});
const { root } = harness;
for (const compiled of [false, true])
  for (const phase of [
    "before-commit",
    "after-commit",
    "worker-ack",
    "worker-drain",
  ])
    harness.test(
      `${compiled ? "standalone" : "source"}: terminal marks ${phase} retain only complete commits`,
      {
        recoveryTimeout: 30000,
        prepare: () => {
          const directory = mkdtempSync(join(root, "case-"));
          return directory;
        },
        crash: async (directory, run) => {
          await run.until(harness.command(compiled), directory, phase, {
            kill: phase !== "worker-drain",
            checkExit: phase === "worker-drain",
          });
        },
        recover: async (directory, run) => {
          const store = await run.reopen(() =>
            openWorldLedger(
              {
                database: join(directory, "world.sqlite"),
                ledger: join(directory, "ledger.json"),
              },
              { clock: systemClock, scheduler: systemScheduler },
            ),
          );
          try {
            const rows = store.terminalMarks.list();
            expect(rows).toHaveLength(phase === "before-commit" ? 0 : 2);
            for (const row of rows) {
              expect(row.binding.record_id).toBe(row.id);
              expect(row.binding.state).toBe("unresolved");
              expect(row.binding.evidence.terminals).toEqual(["terminal-a"]);
            }
            expect((await store.inspect()).integrity).toBe("ok");
          } finally {
            await store.close();
          }
        },
      },
    );
