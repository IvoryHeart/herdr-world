import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger } from "../storage/world-storage";
import { createWorldEffectQueries } from "./queries";

test("server queries distinguish stored intent from a confirmed receipt and preserve its identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-queries-"));
  const storage = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "legacy.json") },
    {
      clock: { now: () => 1000, monotonic: () => 1000 },
      scheduler: {
        schedule(callback, delay) {
          const timer = setTimeout(callback, delay);
          return { cancel: () => clearTimeout(timer) };
        },
      },
    },
  );
  try {
    await storage.ledger.update(
      (document) =>
        document.asks.push({
          id: "q-query",
          at: 1000,
          actor: { label: "Synthetic asker", verified: false },
          question: "Continue?",
          options: [],
          owner_only: true,
        }),
      [
        {
          kind: "ask.created",
          record_id: "q-query",
          recovery: "repeatable",
          target: { connection_id: "example" },
        },
      ],
    );
    const queries = createWorldEffectQueries(storage);
    const notice = (await queries.notices("ask.created")).entries[0]!;
    const intent = (await queries.intent(notice.id))!;
    expect(queries.ask("q-query")?.question).toBe("Continue?");
    expect(await queries.receipt(intent.id)).toMatchObject({
      state: "pending",
      receipt: null,
      ever_dispatched: false,
    });
    const claimed = (await storage.effects.transition({
      action: "claim",
      id: intent.id,
      incarnation: storage.incarnation,
    }))!;
    const fence = claimed.attempt_fence!;
    await storage.effects.transition({
      action: "begin",
      id: intent.id,
      fence,
      targets: [
        {
          capture: intent.target!,
          fence: {
            connection_id: "example",
            generation: 1,
            service_incarnation: storage.incarnation,
          },
        },
      ],
    });
    await storage.effects.transition({
      action: "finish",
      id: intent.id,
      fence,
      state: "delivered",
      reason: "Synthetic source acknowledged",
      receipt: { source: "synthetic", key: intent.contract!.idempotency_key },
    });
    expect(await queries.receipt(intent.id)).toMatchObject({
      intent_id: intent.id,
      operation_id: intent.operation_id,
      version: 1,
      state: "delivered",
      not_sent: false,
      receipt: { source: "synthetic" },
    });
    expect((await queries.notices("ask.created")).entries).toHaveLength(0);
    expect(await queries.intent("missing-intent")).toBeNull();
    expect(await queries.receipt("missing-intent")).toBeNull();
  } finally {
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});
