import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { systemClock, systemScheduler } from "../service/ports";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { createCrashFixture } from "./testing/crash-harness";
const harness = createCrashFixture({
  name: "runtime-status",
  source: resolve(import.meta.dir, "testing/runtime-status-crash-fixture.ts"),
  entry: resolve(import.meta.dir, "../testing/runtime-status-crash-entry.ts"),
  worker: resolve(import.meta.dir, "world-worker.ts"),
});
const { root } = harness;
const paths = (directory: string) => ({
  database: join(directory, "world.sqlite"),
  ledger: join(directory, "ledger.json"),
  settings: join(directory, "settings.json"),
});
const open = (directory: string) =>
  openWorldLedger(paths(directory), {
    clock: systemClock,
    scheduler: systemScheduler,
  });
const a = "connection:alpha:local:/synthetic/repo",
  b = "connection:beta:local:/synthetic/repo";

for (const compiled of [false, true]) {
  const label = compiled ? "standalone" : "source";
  const command = () => harness.command(compiled);
  for (const phase of ["before-commit", "after-commit", "worker-ack"])
    harness.test(
      `${label}: runtime status ${phase} survives as complete committed rows`,
      {
        prepare: async (run) => {
          const directory = mkdtempSync(join(root, "writes-")),
            initial = await run.reopen(() => open(directory));
          await initial.close();
          return directory;
        },
        crash: async (directory, run) => {
          await run.until(command(), directory, phase);
        },
        recover: async (directory, run) => {
          const reopened = await run.reopen(() => open(directory));
          try {
            const rows = reopened.runtimeStatus.list();
            expect(Object.keys(rows).length).toBe(
              phase === "before-commit" ? 0 : 2,
            );
            if (phase !== "before-commit") {
              expect(rows[a]).toMatchObject({
                last_status: "updated",
                last_message: "Synthetic committed run",
              });
              expect(rows[b]).toMatchObject({ last_status: "failed" });
            }
            const info = await reopened.inspect();
            expect(info.integrity).toBe("ok");
            if (phase === "worker-ack")
              console.info(
                `runtime status native ${label}: SQLite ${info.sqlite}; journal ${info.journal_mode}; synchronous ${info.synchronous}`,
              );
          } finally {
            await reopened.close();
          }
        },
      },
    );
  for (const phase of ["import-before-commit", "import-after-commit"])
    harness.test(`${label}: runtime status ${phase} restarts import once`, {
      // Two full ledger opens (worker start, migration, import) plus inspect
      // and close: the same reopen budget as the other ledger-reopen suites.
      recoveryTimeout: 30000,
      prepare: () => {
        const directory = mkdtempSync(join(root, "import-"));
        writeFileSync(
          paths(directory).settings,
          JSON.stringify({
            version: 1,
            custom: { synthetic_secret: "file-only" },
            workspace_auto_sync: {
              [a]: { enabled: true, last_status: "updated" },
              [b]: { enabled: false, last_status: "failed" },
            },
          }),
          { mode: 0o600 },
        );
        return directory;
      },
      crash: async (directory, run) => {
        await run.until(command(), directory, phase);
      },
      recover: async (directory, run) => {
        const db = new Database(paths(directory).database);
        try {
          const count = phase === "import-after-commit" ? 1 : 0;
          expect(
            db.query("SELECT count(*) AS count FROM auto_sync_runs").get(),
          ).toEqual({ count: count * 2 });
          expect(
            db
              .query(
                "SELECT count(*) AS count FROM imports WHERE name='runtime-status-json'",
              )
              .get(),
          ).toEqual({ count });
        } finally {
          db.close();
        }
        for (const file of [
          paths(directory).database,
          `${paths(directory).database}-wal`,
        ])
          if (existsSync(file))
            expect(readFileSync(file).includes(Buffer.from("file-only"))).toBe(
              false,
            );
        if (phase === "import-after-commit")
          writeFileSync(
            paths(directory).settings,
            "{ changed after committed import",
          );
        for (let i = 0; i < 2; i++) {
          const reopened = await run.reopen(() => open(directory));
          try {
            expect(reopened.runtimeStatus.list()).toEqual({
              [a]: { last_status: "updated" },
              [b]: { last_status: "failed" },
            });
            expect((await reopened.inspect()).integrity).toBe("ok");
          } finally {
            await reopened.close();
          }
        }
      },
    });
  harness.test(
    `${label}: runtime status drains 33 accepted writes and closed cached reads never reopen SQLite`,
    {
      prepare: () => {
        const directory = mkdtempSync(join(root, "drain-"));
        return directory;
      },
      crash: async (directory, run) => {
        await run.until(command(), directory, "worker-drain", {
          kill: false,
          checkExit: true,
        });
      },
      recover: async (directory, run) => {
        const reopened = await run.reopen(() => open(directory));
        await reopened.close();
        expect(reopened.runtimeStatus.get(a)?.last_message).toBe(
          "Synthetic 32",
        );
        const before = readFileSync(paths(directory).database);
        await expect(
          reopened.runtimeStatus.put(a, { last_status: "failed" }),
        ).rejects.toThrow(/clos/);
        expect(readFileSync(paths(directory).database)).toEqual(before);
      },
    },
  );
}
