import { randomBytes } from "node:crypto";
import { newWorldId } from "./world-identifiers";
import { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { dirname } from "node:path";
import { assertSafeDataPath } from "../config/data-paths";
import type { LedgerAsk, LedgerDocument } from "../world/world-ledger";
import { importLegacyLedger } from "./world-import";
import { migrateWorldDatabase, worldDatabaseVersion } from "./world-schema";
import {
  attentionFinished,
  attentionRetryDelay,
  STORAGE_BOUNDS,
  type AttentionEntry,
  type LedgerCommit,
  type LedgerWrite,
  type ReplayPage,
  type StorageRequest,
} from "./world-protocol";

function privateFile(path: string, secure = true) {
  assertSafeDataPath(path);
  try {
    const stat = lstatSync(path);
    if (stat.nlink !== 1)
      throw new Error("world.sqlite must not be a hard link");
    if (secure) chmodSync(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Called only by the sole worker (and the crash-test executable). */
export function openWorldWriter(
  path: string,
  legacy: string,
  at: number,
  incarnation = randomBytes(16).toString("base64url"),
) {
  assertSafeDataPath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  privateFile(path, false);
  for (const suffix of ["-wal", "-shm", "-journal"])
    privateFile(`${path}${suffix}`, false);
  try {
    const fd = openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const db = new Database(path, { strict: true });
  try {
    db.exec("PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE;");
    worldDatabaseVersion(db);
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      privateFile(`${path}${suffix}`);
    if (
      (db.query("PRAGMA journal_mode=WAL").get() as { journal_mode: string })
        .journal_mode !== "wal"
    )
      throw new Error("world.sqlite requires WAL support");
    db.exec(
      "PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=1000;",
    );
    migrateWorldDatabase(db, path);
    db.exec("PRAGMA busy_timeout=5000");
    importLegacyLedger(db, legacy, at);
    const interrupted = db
      .query("SELECT id,attempt FROM outbox WHERE state='dispatching'")
      .all() as { id: string; attempt: number }[];
    if (interrupted.length)
      db.transaction(() => {
        for (const row of interrupted)
          db.query(
            "UPDATE outbox SET state='uncertain',due_at=?,evidence=? WHERE id=?",
          ).run(
            at + attentionRetryDelay(row.attempt),
            JSON.stringify({
              reason:
                "Service stopped before the dispatch receipt; delivery is uncertain",
            }),
            row.id,
          );
      })();
  } catch (error) {
    db.close();
    throw error;
  }
  const revision = () =>
    (db.query("SELECT revision FROM ledger_meta").get() as { revision: number })
      .revision;
  const decode = (row: Record<string, unknown>): AttentionEntry =>
    ({
      ...row,
      target: row.target ? JSON.parse(row.target as string) : null,
      evidence: row.evidence ? JSON.parse(row.evidence as string) : null,
    }) as AttentionEntry;
  const attention = (id: string) => {
    const row = db.query("SELECT * FROM outbox WHERE id=?").get(id);
    return row ? decode(row as Record<string, unknown>) : null;
  };
  const forRecord = (id: string) =>
    (
      db
        .query("SELECT * FROM outbox WHERE record_id=? ORDER BY rowid")
        .all(id) as Record<string, unknown>[]
    ).map(decode);
  const read = () => {
    const rows = <T>(table: string) =>
      (
        db.query(`SELECT body FROM ${table} ORDER BY rowid`).all() as {
          body: string;
        }[]
      ).map((row) => JSON.parse(row.body) as T);
    const document: LedgerDocument = {
      version: 1,
      revision: revision(),
      asks: rows("asks"),
      changes: rows("ledger_changes"),
      results: rows("results"),
    };
    return {
      document,
      attention: (
        db.query("SELECT * FROM outbox ORDER BY rowid").all() as Record<
          string,
          unknown
        >[]
      ).map(decode),
    };
  };
  function apply(write: LedgerWrite): LedgerCommit {
    if (write.revision !== revision())
      throw new Error("ledger revision conflict");
    const operationId = newWorldId("o", (id) =>
      Boolean(
        db
          .query(
            "SELECT 1 FROM replay_changes WHERE operation_id=? UNION ALL SELECT 1 FROM outbox WHERE operation_id=? LIMIT 1",
          )
          .get(id, id),
      ),
    );
    const changed = new Set<string>();
    const removed: string[] = [];
    for (const [table, patch] of [
      ["asks", write.asks],
      ["ledger_changes", write.changes],
      ["results", write.results],
    ] as const) {
      for (const id of patch.remove) {
        if (
          table === "asks" &&
          db
            .query("SELECT 1 FROM asks WHERE id=? AND resolved_at IS NULL")
            .get(id)
        )
          throw new Error("cannot remove an unanswered ask");
        if (
          db
            .query(
              "SELECT 1 FROM outbox WHERE record_id=? AND state IN ('pending','dispatching','uncertain')",
            )
            .get(id)
        )
          throw new Error("cannot remove a record with unresolved attention");
        removed.push(...forRecord(id).map((entry) => entry.id));
        db.query("DELETE FROM outbox WHERE record_id=?").run(id);
        db.query(`DELETE FROM ${table} WHERE id=?`).run(id);
        db.query(
          "INSERT INTO replay_changes(operation_id,committed_at,kind,record_id) VALUES(?,?,?,?)",
        ).run(operationId, write.at, `${table}.deleted`, id);
      }
      for (const record of patch.put) {
        if (table === "asks") {
          const ask = record as LedgerAsk;
          const resolved =
            ask.answer?.at ?? ask.dismissed?.at ?? ask.withdrawn?.at ?? null;
          db.query(
            "INSERT INTO asks(id,created_at,resolved_at,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=excluded.resolved_at,body=excluded.body",
          ).run(ask.id, ask.at, resolved, JSON.stringify(ask));
          if (resolved !== null) {
            for (const entry of forRecord(ask.id))
              if (
                entry.kind === "ask.created" &&
                (entry.state === "pending" || entry.state === "uncertain")
              ) {
                db.query(
                  "UPDATE outbox SET state='cancelled',resolved_at=?,evidence=? WHERE id=?",
                ).run(
                  write.at,
                  JSON.stringify({
                    reason: "Question closed before its pending owner alert",
                  }),
                  entry.id,
                );
                changed.add(entry.id);
              }
          }
        } else
          db.query(
            `INSERT INTO ${table}(id,created_at,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
          ).run(record.id, record.at, JSON.stringify(record));
        db.query(
          "INSERT INTO replay_changes(operation_id,committed_at,kind,record_id) VALUES(?,?,?,?)",
        ).run(operationId, write.at, table, record.id);
      }
    }
    for (const effect of write.effects) {
      if (!effect.kind || effect.kind.length > 100 || !effect.record_id)
        throw new Error("invalid declared outbox effect");
      if (
        effect.initial_claim &&
        effect.initial_claim.connection_id !== effect.target?.connection_id
      )
        throw new Error(
          "dispatch claim does not match the captured connection",
        );
      const id = newWorldId("e", (candidate) =>
        Boolean(db.query("SELECT 1 FROM outbox WHERE id=?").get(candidate)),
      );
      db.query(
        "INSERT INTO outbox(id,operation_id,kind,record_id,target,recovery,state,due_at,attempt,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,record_id) DO NOTHING",
      ).run(
        id,
        operationId,
        effect.kind,
        effect.record_id,
        effect.target ? JSON.stringify(effect.target) : null,
        effect.recovery,
        effect.initial_claim ? "dispatching" : "pending",
        write.at,
        effect.initial_claim ? 1 : 0,
        effect.initial_claim
          ? JSON.stringify({
              reason: "Initial owner-alert attempt claimed with the ask",
              fence: effect.initial_claim,
            })
          : null,
        write.at,
      );
      for (const entry of forRecord(effect.record_id)) changed.add(entry.id);
    }
    const next = write.revision + 1;
    db.query("UPDATE ledger_meta SET revision=?").run(next);
    return {
      revision: next,
      attention: [...changed].map((id) => attention(id)!).filter(Boolean),
      removed_attention: removed,
    };
  }
  function replay(
    cursor: { incarnation: string; seq: number } | null,
    limit: number,
  ): ReplayPage {
    if (
      (cursor && (!Number.isSafeInteger(cursor.seq) || cursor.seq < 0)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error("invalid replay cursor or page size");
    const meta = db.query("SELECT replay_floor FROM ledger_meta").get() as {
      replay_floor: number;
    };
    const max = (
      db
        .query("SELECT coalesce(max(seq),0) AS seq FROM replay_changes")
        .get() as { seq: number }
    ).seq;
    const watermark = Math.max(meta.replay_floor, max);
    const after = cursor?.seq ?? 0;
    const reset =
      (cursor !== null && cursor.incarnation !== incarnation) ||
      after < meta.replay_floor ||
      after > watermark;
    const changes = reset
      ? []
      : (db
          .query(
            "SELECT seq,kind,record_id FROM replay_changes WHERE seq>? ORDER BY seq LIMIT ?",
          )
          .all(after, limit) as ReplayPage["changes"]);
    return { incarnation, reset, watermark, changes };
  }
  function execute(request: StorageRequest, at: number): unknown {
    switch (request.type) {
      case "load":
        return read();
      case "write":
        return apply(request.write);
      case "outbox": {
        if (request.id) return attention(request.id);
        if (request.record_id) return forRecord(request.record_id);
        const rows = request.kind
          ? db
              .query(
                "SELECT * FROM outbox WHERE state IN ('pending','uncertain') AND kind=? ORDER BY due_at,id LIMIT 100",
              )
              .all(request.kind)
          : db
              .query(
                "SELECT * FROM outbox WHERE state IN ('pending','uncertain') ORDER BY due_at,id LIMIT 100",
              )
              .all();
        return (rows as Record<string, unknown>[]).map(decode);
      }
      case "claim": {
        const entry = attention(request.id);
        if (
          !entry ||
          entry.due_at > at ||
          (entry.state !== "pending" &&
            !(entry.state === "uncertain" && entry.recovery === "repeatable"))
        )
          return null;
        if (entry.kind === "ask.created") {
          const ask = db
            .query("SELECT resolved_at FROM asks WHERE id=?")
            .get(entry.record_id) as { resolved_at: number | null } | null;
          if (!ask || ask.resolved_at !== null) {
            db.query(
              "UPDATE outbox SET state='cancelled',resolved_at=?,evidence=? WHERE id=?",
            ).run(
              at,
              JSON.stringify({
                reason: "Question closed before owner-alert claim",
              }),
              entry.id,
            );
            return attention(entry.id);
          }
        }
        if (
          request.fence &&
          request.fence.connection_id !== entry.target?.connection_id
        )
          throw new Error("dispatch fence changed the captured connection");
        db.query(
          "UPDATE outbox SET state='dispatching',attempt=attempt+1,evidence=? WHERE id=?",
        ).run(
          JSON.stringify({
            reason: "Dispatch claimed",
            ...(request.fence ? { fence: request.fence } : {}),
          }),
          entry.id,
        );
        return attention(entry.id);
      }
      case "finish": {
        if (request.state === "dispatching")
          throw new Error("finish cannot create a dispatch claim");
        const entry = attention(request.id);
        if (
          !entry ||
          entry.state !== "dispatching" ||
          entry.attempt !== request.attempt
        )
          return null;
        const due = request.due_at ?? at + attentionRetryDelay(entry.attempt);
        // A suspended batch may resume after this persisted deadline is due.
        if (!Number.isSafeInteger(due))
          throw new Error("invalid attention retry deadline");
        db.query(
          "UPDATE outbox SET state=?,evidence=?,resolved_at=?,due_at=? WHERE id=? AND attempt=? AND state='dispatching'",
        ).run(
          request.state,
          JSON.stringify({
            reason: request.reason,
            ...(entry.evidence?.fence ? { fence: entry.evidence.fence } : {}),
          }),
          attentionFinished(request.state) ? at : null,
          due,
          request.id,
          request.attempt,
        );
        return attention(entry.id);
      }
      case "replay":
        return replay(request.cursor, request.limit);
      case "inspect":
        return {
          sqlite: (
            db.query("SELECT sqlite_version() AS version").get() as {
              version: string;
            }
          ).version,
          ...(db.query("PRAGMA journal_mode").get() as object),
          ...(db.query("PRAGMA synchronous").get() as object),
          ...(db.query("PRAGMA locking_mode").get() as object),
          integrity: (
            db.query("PRAGMA integrity_check").get() as {
              integrity_check: string;
            }
          ).integrity_check,
        };
    }
  }
  function prune(at: number) {
    const max = (
      db
        .query("SELECT coalesce(max(seq),0) AS seq FROM replay_changes")
        .get() as { seq: number }
    ).seq;
    const expired = (
      db
        .query(
          "SELECT coalesce(max(seq),0) AS seq FROM replay_changes WHERE committed_at<? OR seq<=?",
        )
        .get(
          at - STORAGE_BOUNDS.replayAgeMs,
          max - STORAGE_BOUNDS.replayRows,
        ) as { seq: number }
    ).seq;
    db.query("UPDATE ledger_meta SET replay_floor=max(replay_floor,?)").run(
      expired,
    );
    db.query("DELETE FROM replay_changes WHERE seq<=?").run(expired);
  }
  return {
    read,
    batch(
      requests: { ticket: number; request: StorageRequest }[],
      at: number,
      fault?: (stage: "before-commit" | "after-commit") => void,
    ) {
      const results: { ticket: number; result?: unknown; error?: string }[] =
        [];
      if (
        requests.every(({ request }) =>
          ["load", "outbox", "replay", "inspect"].includes(request.type),
        )
      )
        return requests.map(({ ticket, request }) => {
          try {
            return { ticket, result: execute(request, at) };
          } catch (error) {
            return { ticket, error: (error as Error).message };
          }
        });
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { ticket, request } of requests) {
          db.exec("SAVEPOINT operation");
          try {
            const result = execute(request, at);
            db.exec("RELEASE operation");
            results.push({ ticket, result });
          } catch (error) {
            db.exec("ROLLBACK TO operation; RELEASE operation");
            results.push({ ticket, error: (error as Error).message });
          }
        }
        prune(at);
        fault?.("before-commit");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      fault?.("after-commit");
      return results;
    },
    close() {
      db.close();
    },
  };
}
