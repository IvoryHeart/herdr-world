import type { Database } from "bun:sqlite";
import { effectContract, type EffectVerbLookup } from "../effects/contracts";
import type { EffectContract } from "../effects/types";
import type { LedgerAsk } from "../world/world-ledger";
import type { OutboxEffect } from "./world-protocol";

/** Upgrade metadata in-place; existing IDs, receipts, and payloads are retained. */
export function migrateEffectContracts(db: Database, verbs: EffectVerbLookup) {
  db.transaction(() => {
    const rows = db
      .query("SELECT * FROM outbox WHERE contract IS NULL")
      .all() as Record<string, unknown>[];
    for (const row of rows) {
      const domain = db
        .query("SELECT body FROM asks WHERE id=?")
        .get(row.record_id as string) as { body: string } | null;
      try {
        const contract = effectContract(
          {
            kind: row.kind as string,
            record_id: row.record_id as string,
            recovery: row.recovery as OutboxEffect["recovery"],
            target: row.target ? JSON.parse(row.target as string) : null,
            intent: row.intent ? JSON.parse(row.intent as string) : undefined,
          },
          row.id as string,
          domain ? (JSON.parse(domain.body) as LedgerAsk) : null,
          verbs,
        );
        if (contract)
          db.query("UPDATE outbox SET contract=? WHERE id=?").run(
            JSON.stringify(contract),
            row.id as string,
          );
      } catch {
        db.query(
          "UPDATE outbox SET needs_migration=1,evidence=? WHERE id=? AND state IN ('pending','uncertain','dispatching')",
        ).run(
          JSON.stringify({
            reason: "Legacy effect contract needs explicit migration",
          }),
          row.id as string,
        );
      }
    }
    const contracts = db
      .query(
        "SELECT id,contract,evidence FROM outbox WHERE contract IS NOT NULL AND state IN ('pending','uncertain','dispatching')",
      )
      .all() as { id: string; contract: string; evidence: string | null }[];
    for (const row of contracts) {
      const contract = JSON.parse(row.contract) as EffectContract;
      if (verbs(contract.verb)?.version !== contract.version)
        db.query(
          "UPDATE outbox SET needs_migration=1,evidence=? WHERE id=?",
        ).run(
          JSON.stringify({
            ...(row.evidence ? JSON.parse(row.evidence) : {}),
            reason: "Operation version needs explicit migration",
          }),
          row.id,
        );
    }
  })();
}
