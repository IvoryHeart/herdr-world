import { newWorldId } from "./world-identifiers";
import { randomBytes } from "node:crypto";
import {
  askClosed,
  LEDGER_LIMITS,
  type LedgerAsk,
  type LedgerDocument,
  type LedgerStore,
} from "../world/world-ledger";
import { openWorldClient } from "./world-client";
import {
  attentionFinished,
  STORAGE_BOUNDS,
  StorageWriteRejected,
  type AttentionEntry,
  type LedgerCommit,
  type Rows,
  type StoragePorts,
  type WorldLedgerStorage,
} from "./world-protocol";

export type { WorldLedgerStorage } from "./world-protocol";

function diff<T extends { id: string }>(before: T[], after: T[]): Rows<T> {
  const old = new Map(before.map((row) => [row.id, JSON.stringify(row)]));
  const ids = new Set(after.map((row) => row.id));
  if (ids.size !== after.length) throw new Error("duplicate ledger record ID");
  return {
    put: after.filter((row) => old.get(row.id) !== JSON.stringify(row)),
    remove: before.filter((row) => !ids.has(row.id)).map((row) => row.id),
  };
}

/** Independent instance; every read reflects only acknowledged SQLite commits. */
export async function openWorldLedger(
  paths: { database: string; ledger: string },
  ports: StoragePorts,
): Promise<WorldLedgerStorage> {
  const incarnation = randomBytes(16).toString("base64url");
  const client = await openWorldClient(
    paths.database,
    paths.ledger,
    ports,
    undefined,
    incarnation,
  );
  let document = client.snapshot.document;
  const byRecord = new Map<string, AttentionEntry[]>();
  const remember = (entry: AttentionEntry) => {
    const entries = byRecord.get(entry.record_id) ?? [];
    const index = entries.findIndex((known) => known.id === entry.id);
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
    byRecord.set(entry.record_id, entries);
  };
  let tail = Promise.resolve();
  let queued = 0;
  let closing = false;
  let closed: Promise<void> | undefined;
  for (const entry of client.snapshot.attention) remember(entry);
  const refresh = async (recordId?: string, kind?: string) => {
    const entries = await client.request<AttentionEntry[]>({
      type: "outbox",
      kind,
      ...(recordId ? { record_id: recordId } : {}),
    });
    if (recordId) byRecord.delete(recordId);
    for (const entry of entries) remember(entry);
    return entries;
  };
  const decoratedAsk = (source: LedgerAsk): LedgerAsk => {
    const ask = structuredClone(source);
    // Delivery is evidence from this outbox, never an imported JSON annotation.
    delete ask.delivery;
    for (const entry of byRecord.get(ask.id) ?? []) {
      const field = entry.kind === "ask.created" ? "notification" : null;
      if (field)
        (ask.delivery ??= {})[field] = {
          state: entry.state,
          ...(entry.evidence ? { reason: entry.evidence.reason } : {}),
        };
    }
    return ask;
  };
  const pinned = (id: string) =>
    (byRecord.get(id) ?? []).some((entry) => !attentionFinished(entry.state));
  const trim = (next: LedgerDocument) => {
    for (const [rows, max] of [
      [next.changes, LEDGER_LIMITS.changes],
      [next.results, LEDGER_LIMITS.results],
      [next.asks, LEDGER_LIMITS.asks],
    ] as const) {
      let excess = rows.length - max;
      for (let i = 0; i < rows.length && excess > 0; ) {
        const row = rows[i]!;
        if (
          pinned(row.id) ||
          (rows === next.asks &&
            !askClosed(row as LedgerDocument["asks"][number]))
        )
          i++;
        else {
          rows.splice(i, 1);
          excess--;
        }
      }
    }
  };
  const ledger: LedgerStore = {
    nextId: (kind) =>
      newWorldId(kind, (id) =>
        [...document.asks, ...document.changes, ...document.results].some(
          (row) => row.id === id,
        ),
      ),
    get: () => ({
      ...structuredClone(document),
      asks: document.asks.map(decoratedAsk),
    }),
    ask: (id) => {
      const ask = document.asks.find((entry) => entry.id === id);
      return ask && decoratedAsk(ask);
    },
    change: (id) =>
      structuredClone(document.changes.find((entry) => entry.id === id)),
    openAsks: () => ({
      revision: document.revision,
      asks: document.asks
        .filter((entry) => !askClosed(entry))
        .map(decoratedAsk),
    }),
    update(change, effects = []) {
      if (closing)
        return Promise.reject(
          new StorageWriteRejected("World storage is closing"),
        );
      if (queued >= STORAGE_BOUNDS.queuedOperations)
        return Promise.reject(
          new StorageWriteRejected("World ledger admission limit reached"),
        );
      queued++;
      const operation = tail.then(async () => {
        const next = structuredClone(document);
        change(next);
        trim(next);
        const asks = diff(document.asks, next.asks);
        const changes = diff(document.changes, next.changes);
        const results = diff(document.results, next.results);
        const declaredEffects =
          typeof effects === "function" ? effects() : effects;
        if (
          !declaredEffects.length &&
          ![asks, changes, results].some(
            (patch) => patch.put.length || patch.remove.length,
          )
        )
          return document.revision;
        const commit = await client.request<LedgerCommit>({
          type: "write",
          write: {
            at: ports.clock.now(),
            revision: document.revision,
            asks,
            changes,
            results,
            effects: declaredEffects,
          },
        });
        next.revision = commit.revision;
        document = next;
        for (const id of commit.removed_attention) {
          for (const [record, entries] of byRecord) {
            const kept = entries.filter((entry) => entry.id !== id);
            if (!kept.length) byRecord.delete(record);
            else if (kept.length !== entries.length) byRecord.set(record, kept);
          }
        }
        for (const entry of commit.attention) remember(entry);
        return commit.revision;
      });
      tail = operation.then(
        () => {
          queued--;
        },
        () => {
          queued--;
        },
      );
      return operation;
    },
  };
  return {
    ledger,
    incarnation,
    outbox: {
      list: (kind) => refresh(undefined, kind),
      forRecord: (id) => refresh(id),
      async get(id) {
        const entry = await client.request<AttentionEntry | null>({
          type: "outbox",
          id,
        });
        if (entry) remember(entry);
        return entry;
      },
      async claim(id, fence) {
        const entry = await client.request<AttentionEntry | null>({
          type: "claim",
          id,
          fence,
        });
        if (entry) remember(entry);
        return entry;
      },
      async finish(id, attempt, state, reason, dueAt) {
        const entry = await client.request<AttentionEntry | null>({
          type: "finish",
          id,
          attempt,
          state,
          reason,
          due_at: dueAt,
        });
        if (entry) remember(entry);
        return entry;
      },
    },
    failed: client.failed,
    replay: (cursor, limit = 100) =>
      client.request({ type: "replay", cursor, limit }),
    inspect: () => client.request({ type: "inspect" }),
    close() {
      if (closed) return closed;
      closing = true;
      closed = tail.then(() => client.close());
      return closed;
    },
  };
}
