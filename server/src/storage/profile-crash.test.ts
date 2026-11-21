import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { systemClock, systemScheduler } from "../service/ports";
import { seededProfiles } from "../agent/profile-store";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { createCrashFixture } from "./testing/crash-harness";
const harness = createCrashFixture({
  name: "profile",
  source: resolve(import.meta.dir, "testing/profile-crash-fixture.ts"),
  entry: resolve(import.meta.dir, "../testing/profile-crash-entry.ts"),
  worker: resolve(import.meta.dir, "world-worker.ts"),
});
const { root } = harness;
const paths = (directory: string) => ({
  database: join(directory, "world.sqlite"),
  ledger: join(directory, "ledger.json"),
  profiles: join(directory, "agent-profiles.json"),
});
const open = (directory: string) =>
  openWorldLedger(paths(directory), {
    clock: systemClock,
    scheduler: systemScheduler,
  });

for (const compiled of [false, true]) {
  const label = compiled ? "standalone" : "source";
  const command = () => harness.command(compiled);
  for (const phase of ["before-commit", "after-commit", "worker-ack"])
    harness.test(
      `${label}: profile/chime/import-state crash ${phase} is atomic`,
      {
        prepare: async (run) => {
          const directory = mkdtempSync(join(root, "edits-"));
          const initial = await run.reopen(() => open(directory));
          const before = initial.profiles.get();
          await initial.close();
          return { directory, before };
        },
        crash: async ({ directory }, run) => {
          await run.until(command(), directory, phase);
        },
        recover: async ({ directory, before }, run) => {
          const reopened = await run.reopen(() => open(directory));
          try {
            const after = reopened.profiles.get(),
              committed = phase !== "before-commit";
            expect(reopened.profiles.profile("builder")?.role).toBe(
              committed
                ? "Committed synthetic role"
                : before.profiles.find((profile) => profile.id === "builder")!
                    .role,
            );
            expect(after.chimes.motifs.for_you).toBe(
              committed ? false : before.chimes.motifs.for_you,
            );
            expect(after.terminal_settings!.highest_master_revision).toBe(
              committed ? 321 : 0,
            );
            expect(after.terminal_settings!.imported_connections).toEqual(
              committed ? ["studio"] : [],
            );
            expect((await reopened.inspect()).integrity).toBe("ok");
          } finally {
            await reopened.close();
          }
        },
      },
    );
  for (const phase of ["import-before-commit", "import-after-commit"])
    harness.test(`${label}: ${phase} restarts the JSON import exactly once`, {
      prepare: () => {
        const directory = mkdtempSync(join(root, "import-"));
        const document = {
          ...seededProfiles(),
          revision: 7,
          terminal_settings: {
            imported_connections: ["earlier-host"],
            highest_master_revision: 123,
          },
        };
        const original = JSON.stringify(document);
        writeFileSync(paths(directory).profiles, original, { mode: 0o600 });
        return { directory, document };
      },
      crash: async ({ directory }, run) => {
        await run.until(command(), directory, phase);
      },
      recover: async ({ directory, document }, run) => {
        const db = new Database(paths(directory).database);
        try {
          const count = phase === "import-after-commit" ? 1 : 0;
          expect(
            db.query("SELECT count(*) AS count FROM profile_store_meta").get(),
          ).toEqual({ count });
          expect(
            db
              .query(
                "SELECT count(*) AS count FROM imports WHERE name='agent-profiles-json'",
              )
              .get(),
          ).toEqual({ count });
          expect(
            db.query("SELECT count(*) AS count FROM agent_profiles").get(),
          ).toEqual({ count: count * 4 });
          expect(
            db.query("SELECT count(*) AS count FROM profile_chimes").get(),
          ).toEqual({ count });
        } finally {
          db.close();
        }
        if (phase === "import-after-commit")
          writeFileSync(
            paths(directory).profiles,
            "{ ignored after committed import",
          );
        const reopened = await run.reopen(() => open(directory));
        expect(reopened.profiles.get()).toEqual(document);
        await reopened.close();
        const again = await run.reopen(() => open(directory));
        expect(again.profiles.get()).toEqual(document);
        await again.close();
      },
    });
  harness.test(
    `${label}: close drains a partial profile group and leaves its committed cache usable`,
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
        expect(reopened.profiles.profile("builder")?.name).toBe("Synthetic 32");
        expect(reopened.profiles.get().revision).toBe(33);
        await reopened.close();
        expect(reopened.profiles.profile("builder")?.name).toBe("Synthetic 32");
        const database = readFileSync(paths(directory).database);
        await expect(reopened.profiles.delete("builder")).rejects.toThrow(
          /clos/,
        );
        expect(readFileSync(paths(directory).database)).toEqual(database);
      },
    },
  );
}
