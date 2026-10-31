import {
  recordAnswerAttempt,
  answerAttemptEvidence,
  recoverAttention,
} from "./answer-attempts";
import { answerTransitions } from "./answer-transitions";
import {
  ANSWER_DELIVERY_VERB,
  isAnswerIntent,
  originalAsker,
} from "../world/ask-delivery-types";
import { readProfiles, executeProfileOperation } from "./world-profiles";
import { importRuntimeStatus } from "./runtime-status-import";
import { readRuntimeStatus, writeRuntimeStatus } from "./runtime-status";
import { importLegacyProfiles } from "./profile-import";
import { randomBytes } from "node:crypto";
import { createWorldIds } from "./world-ids";
import { createBindingWriter } from "./world-bindings";
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
  bytes?: () => Uint8Array,
  legacyProfiles?: string,
  profileImportFault?: (stage: "before-commit" | "after-commit") => void,
  runtimeImport?: {
    path: string;
    fault?: (stage: "before-commit" | "after-commit") => void;
  },
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
    if (legacyProfiles !== undefined)
      importLegacyProfiles(db, legacyProfiles, at, profileImportFault);
    if (runtimeImport)
      importRuntimeStatus(db, runtimeImport.path, at, runtimeImport.fault);
    recoverAttention(db, at);
  } catch (error) {
    db.close();
    throw error;
  }
  const ids = createWorldIds(db, bytes);
  const bindings = createBindingWriter(db, ids);
  const revision = () =>
    (db.query("SELECT revision FROM ledger_meta").get() as { revision: number })
      .revision;
  const decode = (row: Record<string, unknown>): AttentionEntry =>
    ({
      ...row,
      target: row.target ? JSON.parse(row.target as string) : null,
      evidence: row.evidence ? JSON.parse(row.evidence as string) : null,
      intent: row.intent ? JSON.parse(row.intent as string) : null,
      claimed: Boolean(row.claimed),
      ...(row.kind === ANSWER_DELIVERY_VERB.name
        ? answerAttemptEvidence(db, row.id as string, row.attempt as number)
        : {}),
    }) as AttentionEntry;
  const attention = (id: string) => {
    const row = db.query("SELECT * FROM outbox WHERE id=?").get(id);
    return row ? decode(row as Record<string, unknown>) : null;
  };
  const answer = answerTransitions(db, attention);
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
    const profiles = readProfiles(db);
    const runtimeStatus = readRuntimeStatus(db);
    return {
      document,
      ...(profiles ? { profiles } : {}),
      ...(runtimeStatus ? { runtimeStatus } : {}),
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
    const operationId = ids.issue("o");
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
          const stored = db
            .query("SELECT body FROM asks WHERE id=?")
            .get(ask.id) as { body: string } | null;
          const previous = stored
            ? (JSON.parse(stored.body) as LedgerAsk)
            : null;
          if (
            previous?.answer &&
            (!ask.answer ||
              previous.answer.text !== ask.answer.text ||
              previous.answer.at !== ask.answer.at ||
              previous.answer.by !== ask.answer.by ||
              previous.answer.occurrence !== ask.answer.occurrence)
          )
            throw new Error("A stored answer occurrence is immutable");
          const resolved =
            ask.answer?.at ?? ask.dismissed?.at ?? ask.withdrawn?.at ?? null;
          db.query(
            "INSERT INTO asks(id,created_at,resolved_at,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=excluded.resolved_at,body=excluded.body",
          ).run(ask.id, ask.at, resolved, JSON.stringify(ask));
          if (resolved !== null) {
            for (const entry of forRecord(ask.id))
              if (
                (entry.kind === "ask.created" &&
                  (entry.state === "pending" || entry.state === "uncertain")) ||
                (entry.kind === ANSWER_DELIVERY_VERB.name &&
                  ask.withdrawn &&
                  entry.state === "pending")
              ) {
                db.query(
                  "UPDATE outbox SET state='cancelled',claimed=0,resolved_at=?,evidence=? WHERE id=?",
                ).run(
                  write.at,
                  JSON.stringify({
                    reason:
                      entry.kind === "ask.created"
                        ? "Question closed before its pending owner alert"
                        : "Asker withdrew before answer delivery",
                  }),
                  entry.id,
                );
                if (entry.kind === ANSWER_DELIVERY_VERB.name && entry.claimed)
                  recordAnswerAttempt(
                    db,
                    entry.id,
                    entry.attempt,
                    "cancelled",
                    entry.evidence?.fence,
                    write.at,
                    "Asker withdrew before submission",
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
      const id = ids.issue("e");
      if (effect.kind === ANSWER_DELIVERY_VERB.name) {
        const row = db
          .query("SELECT body FROM asks WHERE id=?")
          .get(effect.record_id) as { body: string } | null;
        const ask = row && (JSON.parse(row.body) as LedgerAsk | null);
        if (
          !isAnswerIntent(effect.intent) ||
          effect.recovery !== "opaque" ||
          effect.initial_claim ||
          effect.intent?.verb !== ANSWER_DELIVERY_VERB.name ||
          effect.intent.params.ask_id !== effect.record_id ||
          !ask?.answer?.occurrence ||
          effect.intent.params.answer_occurrence !== ask.answer.occurrence ||
          Object.keys(effect.intent.params).length !== 2 ||
          effect.intent.origin !== "world.ask.answer" ||
          effect.intent.condition?.awaiting_delivery !== true ||
          Object.keys(effect.intent).some(
            (key) =>
              ![
                "verb",
                "version",
                "origin",
                "params",
                "actor",
                "condition",
              ].includes(key),
          ) ||
          Object.keys(effect.intent.condition).some(
            (key) => !["awaiting_delivery", "recipient"].includes(key),
          ) ||
          !Number.isSafeInteger(effect.intent.version) ||
          effect.intent.version < 1 ||
          !["owner", "agent"].includes(effect.intent.actor?.kind) ||
          ask.withdrawn ||
          ask.dismissed ||
          (effect.intent.actor.kind === "agent" &&
            (ask.owner_only ||
              !effect.intent.actor.actor.verified ||
              originalAsker(ask.recipient, effect.intent.actor.actor)))
        )
          throw new Error(
            "Answer intent must reference its stored answer occurrence without copied text",
          );
      }
      const state = effect.initial_claim
        ? "dispatching"
        : (effect.initial_state ?? "pending");
      const due = effect.due_at ?? write.at;
      if (!Number.isSafeInteger(due))
        throw new Error("invalid intent deadline");
      db.query(
        "INSERT INTO outbox(id,operation_id,kind,record_id,target,recovery,state,due_at,attempt,evidence,created_at,resolved_at,intent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,record_id) DO NOTHING",
      ).run(
        id,
        operationId,
        effect.kind,
        effect.record_id,
        effect.target ? JSON.stringify(effect.target) : null,
        effect.recovery,
        state,
        due,
        effect.initial_claim ? 1 : 0,
        effect.initial_claim
          ? JSON.stringify({
              reason: "Initial owner-alert attempt claimed with the ask",
              fence: effect.initial_claim,
            })
          : effect.reason
            ? JSON.stringify({ reason: effect.reason })
            : null,
        write.at,
        attentionFinished(state) ? write.at : null,
        effect.intent ? JSON.stringify(effect.intent) : null,
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
      case "issue-id":
        return ids.issue(request.kind);
      case "runtime-status":
        if (
          !db
            .query("SELECT 1 FROM imports WHERE name='runtime-status-json'")
            .get()
        )
          throw new Error("Runtime status was not initialized");
        return writeRuntimeStatus(db, request.key, request.status);
      case "profiles":
        return executeProfileOperation(db, request.operation);
      case "binding":
        return bindings.execute(request.operation, at);
      case "write":
        return apply(request.write);
      case "begin-dispatch":
        return answer.begin(request.id, request.attempt, request.fence, at);
      case "acknowledge":
        return answer.acknowledge(
          request.id,
          request.occurrence,
          request.attempt,
          request.actor,
          at,
        );
      case "decide":
        return answer.decide(
          request.id,
          request.occurrence,
          request.attempt,
          request.action,
          at,
        );
      case "notices": {
        if (
          !Number.isInteger(request.limit) ||
          request.limit < 1 ||
          request.limit > 100
        )
          throw new Error("invalid notice limit");
        const entries = (
          db
            .query(
              "SELECT * FROM outbox WHERE kind=? AND state NOT IN ('delivered','cancelled') AND (? IS NULL OR rowid < (SELECT rowid FROM outbox WHERE id=?)) ORDER BY rowid DESC LIMIT ?",
            )
            .all(
              request.kind,
              request.after ?? null,
              request.after ?? null,
              request.limit,
            ) as Record<string, unknown>[]
        ).map(decode);
        const counts = db
          .query(
            "SELECT state,json_extract(target,'$.connection_id') AS connection_id,count(*) AS count FROM outbox WHERE kind=? AND state NOT IN ('delivered','cancelled') GROUP BY state,connection_id",
          )
          .all(request.kind) as {
          state: string;
          connection_id: string | null;
          count: number;
        }[];
        let checks = 0,
          waiting = 0;
        const connections: Record<string, number> = Object.create(null);
        for (const row of counts) {
          if (["uncertain", "refused"].includes(row.state)) checks += row.count;
          else waiting += row.count;
          if (row.connection_id)
            connections[row.connection_id] =
              (connections[row.connection_id] ?? 0) + row.count;
        }
        return { entries, checks, waiting, connections };
      }
      case "outbox": {
        if (request.id) return attention(request.id);
        if (request.record_id) return forRecord(request.record_id);
        if (request.ready_only)
          return (
            db
              .query(
                "SELECT * FROM outbox WHERE claimed=0 AND (state='pending' OR (state='uncertain' AND recovery='repeatable')) AND kind=? ORDER BY due_at,id LIMIT 100",
              )
              .all(request.kind ?? "") as Record<string, unknown>[]
          ).map(decode);
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
          entry.claimed ||
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
              "UPDATE outbox SET state='cancelled',claimed=0,resolved_at=?,evidence=? WHERE id=?",
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
        const claimOnly = entry.kind === ANSWER_DELIVERY_VERB.name;
        db.query(
          "UPDATE outbox SET state=?,claimed=?,attempt=attempt+1,evidence=? WHERE id=?",
        ).run(
          claimOnly ? "pending" : "dispatching",
          claimOnly ? 1 : 0,
          JSON.stringify({
            reason: "Dispatch claimed",
            ...(request.fence ? { fence: request.fence } : {}),
          }),
          entry.id,
        );
        if (claimOnly)
          recordAnswerAttempt(
            db,
            entry.id,
            entry.attempt + 1,
            "claimed",
            request.fence,
            at,
            "Claimed for current checks",
          );
        return attention(entry.id);
      }
      case "finish": {
        if (request.state === "dispatching")
          throw new Error("finish cannot create a dispatch claim");
        const entry = attention(request.id);
        if (
          !entry ||
          (entry.state !== "dispatching" &&
            !(entry.state === "pending" && entry.claimed)) ||
          entry.attempt !== request.attempt
        )
          return null;
        const due = request.due_at ?? at + attentionRetryDelay(entry.attempt);
        // A suspended batch may resume after this persisted deadline is due.
        if (!Number.isSafeInteger(due))
          throw new Error("invalid attention retry deadline");
        db.query(
          "UPDATE outbox SET state=?,claimed=0,evidence=?,resolved_at=?,due_at=? WHERE id=? AND attempt=?",
        ).run(
          entry.cli_received_at !== null ? "delivered" : request.state,
          JSON.stringify({
            reason:
              entry.cli_received_at !== null
                ? `Answer received by asker CLI; ${request.reason}`
                : request.reason,
            ...(entry.evidence?.fence ? { fence: entry.evidence.fence } : {}),
          }),
          entry.cli_received_at !== null || attentionFinished(request.state)
            ? at
            : null,
          due,
          request.id,
          request.attempt,
        );
        if (entry.kind === ANSWER_DELIVERY_VERB.name)
          recordAnswerAttempt(
            db,
            entry.id,
            entry.attempt,
            request.state,
            entry.evidence?.fence,
            at,
            request.reason,
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
          ["load", "outbox", "notices", "replay", "inspect"].includes(
            request.type,
          ),
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
