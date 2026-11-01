import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { createCrashFixture } from "./testing/crash-harness";
const harness = createCrashFixture({
  name: "answer",
  source: resolve(
    import.meta.dir,
    "../world/testing/answer-delivery-process.ts",
  ),
  entry: resolve(import.meta.dir, "../testing/answer-delivery-entry.ts"),
  worker: resolve(import.meta.dir, "world-worker.ts"),
  compileTimeout: 120000,
  childTimeout: 30000,
});
const { root } = harness;
const ports = {
  clock: { now: () => 2_000_000, monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};
function received(directory: string) {
  const path = join(directory, "receiver.sqlite");
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.query("SELECT body FROM received ORDER BY seq").all() as {
        body: string;
      }[]
    ).map((row) => row.body);
  } finally {
    db.close();
  }
}
for (const compiled of [false, true]) {
  const label = compiled ? "standalone compiled" : "source",
    executable = () => harness.command(compiled);
  for (const phase of [
    "before-claim",
    "after-claim",
    "before-effect",
    "after-effect",
    "after-receipt",
  ])
    harness.test(
      `${label}: actual Chat recovery after ${phase} keeps opaque submission honest`,
      {
        recoveryTimeout: 60000,
        prepare: () => {
          const directory = mkdtempSync(join(root, "case-"));
          return directory;
        },
        crash: async (directory, run) => {
          await run.until(executable(), directory, phase);
        },
        recover: async (directory, run) => {
          const possible =
            phase === "before-effect" || phase === "after-effect";
          const delivered = phase === "after-receipt";
          const storage = await run.reopen(() =>
            openWorldLedger(
              {
                database: join(directory, "world.sqlite"),
                ledger: join(directory, "legacy.json"),
              },
              ports,
            ),
          );
          try {
            const ask = storage.ledger.ask("q-native")!;
            expect(ask.answer?.text).toBe("Stored fixture answer");
            const [entry] = await storage.outbox.forRecord(ask.id);
            expect(entry?.state).toBe(
              possible ? "uncertain" : delivered ? "delivered" : "pending",
            );
            expect(entry?.claimed).toBe(false);
            expect(JSON.stringify(entry?.intent)).not.toContain(
              "Stored fixture answer",
            );
            if (possible)
              expect(entry?.attempts).toMatchObject([{ state: "uncertain" }]);
          } finally {
            await storage.close();
          }
          const { code, output, error } = await run.capture(
            [...executable(), directory, "recover"],
            30_000,
          );
          expect(code, error).toBe(0);
          expect(JSON.parse(output).answer).toBe("Stored fixture answer");
          const messages = received(directory);
          expect(messages).toHaveLength(
            phase === "after-effect" || delivered ? 1 : 0,
          );
          if (messages.length)
            expect(messages[0]).toBe(
              "Answer to q-native:\nQuestion: Proceed with the fixture?\nAnswer from owner: Stored fixture answer",
            );
          expect(JSON.parse(output).state).toBe(
            possible ? "uncertain" : delivered ? "delivered" : "refused",
          );
        },
      },
    );
}
