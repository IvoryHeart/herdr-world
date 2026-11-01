import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { createCrashFixture } from "./testing/crash-harness";
const harness = createCrashFixture({
  name: "storage",
  source: resolve(import.meta.dir, "testing/crash-fixture.ts"),
  entry: resolve(import.meta.dir, "../testing/storage-crash-entry.ts"),
  worker: resolve(import.meta.dir, "world-worker.ts"),
});
const { root } = harness;
const ports = {
  clock: { now: () => 1000, monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};
const reopen = (directory: string) =>
  openWorldLedger(
    {
      database: join(directory, "world.sqlite"),
      ledger: join(directory, "ledger.json"),
    },
    ports,
  );

for (const compiled of [false, true]) {
  const label = compiled ? "standalone compiled" : "source",
    executable = () => harness.command(compiled);
  harness.test(
    `${label}: worker acknowledgements survive whole-process kill; partial queue drains`,
    {
      recoveryTimeout: 30000,
      children: 2,
      prepare: () => {
        const directory = mkdtempSync(join(root, "ack-")),
          drain = mkdtempSync(join(root, "drain-"));
        return { directory, drain };
      },
      crash: async ({ directory, drain }, run) => {
        await run.until(executable(), directory, "worker-ack", {
          marker: "ack",
        });
        await run.until(executable(), drain, "worker-drain", {
          marker: "drained",
          kill: false,
        });
      },
      recover: async ({ directory, drain }, run) => {
        const storage = await run.reopen(() => reopen(directory));
        try {
          expect(storage.ledger.ask("q-ack")?.answer?.text).toBe(
            "Acknowledged",
          );
          expect(await storage.outbox.list()).toHaveLength(2);
          expect((await storage.inspect()).integrity).toBe("ok");
        } finally {
          await storage.close();
        }
        const drained = await run.reopen(() => reopen(drain));
        try {
          expect(drained.ledger.get().asks).toHaveLength(33);
        } finally {
          await drained.close();
        }
      },
    },
  );
  for (const phase of ["before-commit", "after-commit"])
    harness.test(
      `${label}: crash ${phase} preserves atomic domain and outbox`,
      {
        prepare: () => {
          const directory = mkdtempSync(join(root, "commit-"));
          return directory;
        },
        crash: async (directory, run) => {
          await run.until(executable(), directory, phase);
        },
        recover: async (directory, run) => {
          const storage = await run.reopen(() => reopen(directory));
          try {
            const committed = phase === "after-commit";
            expect(Boolean(storage.ledger.ask("q-interrupted")?.answer)).toBe(
              committed,
            );
            expect(await storage.outbox.list()).toHaveLength(committed ? 1 : 0);
            expect((await storage.inspect()).integrity).toBe("ok");
          } finally {
            await storage.close();
          }
        },
      },
    );
  for (const phase of [
    "answer-before-effect",
    "answer-after-effect",
    "answer-after-receipt",
    "notification-after-effect",
  ])
    harness.test(`${label}: crash ${phase} follows the effect recovery class`, {
      recoveryTimeout: 30000,
      children: 2,
      prepare: () => {
        const directory = mkdtempSync(join(root, "effect-"));

        return directory;
      },
      crash: async (directory, run) => {
        await run.until(executable(), directory, "worker-ack", {
          marker: "ack",
        });
        await run.until(executable(), directory, phase);
      },
      recover: async (directory, run) => {
        const storage = await run.reopen(() => reopen(directory));
        let due: Awaited<ReturnType<typeof reopen>> | undefined;
        try {
          const notification = phase.startsWith("notification");
          const entry = (
            await storage.outbox.forRecord(notification ? "q-owner" : "q-ack")
          ).find(
            (entry) =>
              entry.kind ===
              (notification ? "ask.created" : "synthetic.answer"),
          )!;
          const delivered = phase.endsWith("after-receipt");
          expect(entry.state).toBe(delivered ? "delivered" : "uncertain");
          expect(storage.ledger.ask("q-ack")?.answer?.text).toBe(
            "Acknowledged",
          );
          expect(await storage.outbox.claim(entry.id)).toBeNull();
          await storage.close();
          due = await run.reopen(() =>
            openWorldLedger(
              {
                database: join(directory, "world.sqlite"),
                ledger: join(directory, "ledger.json"),
              },
              { ...ports, clock: { ...ports.clock, now: () => entry.due_at } },
            ),
          );
          const retried = await due.outbox.claim(entry.id);
          expect(Boolean(retried)).toBe(notification);
          if (retried) {
            // Deduplication belongs to this synthetic receiver, never to Herdr.
            const receiver = new Database(join(directory, "receiver.sqlite"));
            try {
              receiver
                .query("INSERT OR IGNORE INTO receipts VALUES(?)")
                .run(entry.id);
              expect(
                (
                  receiver
                    .query("SELECT count(*) AS count FROM receipts")
                    .get() as { count: number }
                ).count,
              ).toBe(1);
            } finally {
              receiver.close();
            }
            await due.outbox.finish(
              entry.id,
              retried.attempt,
              "delivered",
              "Synthetic receiver deduplicated the operation ID",
            );
          }
        } finally {
          await due?.close();
          await storage.close();
        }
      },
    });
}
