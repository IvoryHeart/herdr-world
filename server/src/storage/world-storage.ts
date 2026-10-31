import { createRuntimeStatusPort } from "./runtime-status";
import { createProfilePort } from "./profile-port";
import { ANSWER_DELIVERY_VERB } from "../world/ask-delivery-types";
import type { WorldIds } from "./world-ids";
import type { BindingOperation } from "./world-bindings";
import type {
  LegacyBindingCapture,
  LegacyBindingOperation,
} from "./legacy-bindings";
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
  type AttentionNotices,
  type LedgerCommit,
  type Rows,
  type StoragePorts,
  type StorageRequest,
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
  paths: {
    database: string;
    ledger: string;
    profiles?: string;
    settings?: string;
  },
  ports: StoragePorts,
): Promise<WorldLedgerStorage> {
  const incarnation = randomBytes(16).toString("base64url");
  const client = await openWorldClient(
    paths.database,
    paths.ledger,
    ports,
    undefined,
    incarnation,
    paths.profiles,
    paths.settings,
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
  const profiles = createProfilePort(
    client.snapshot.profiles ?? null,
    <T>(request: StorageRequest) => {
      if (closing)
        return Promise.reject<T>(
          new StorageWriteRejected("World storage is closing"),
        );
      return client.request<T>(request);
    },
  );
  const runtimeStatus = createRuntimeStatusPort(
    client.snapshot.runtimeStatus ?? {},
    <T>(request: StorageRequest) => {
      if (closing)
        return Promise.reject<T>(
          new StorageWriteRejected("World storage is closing"),
        );
      return client.request<T>(request);
    },
  );
  for (const entry of client.snapshot.attention) remember(entry);
  const transition = async (request: StorageRequest) => {
    const entry = await client.request<AttentionEntry | null>(request);
    if (entry) remember(entry);
    return entry;
  };
  const refresh = async (
    recordId?: string,
    kind?: string,
    readyOnly = false,
  ) => {
    const entries = await client.request<AttentionEntry[]>({
      type: "outbox",
      kind,
      ready_only: readyOnly,
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
      if (entry.kind === ANSWER_DELIVERY_VERB.name && entry.intent)
        (ask.delivery ??= {}).answer = {
          id: entry.id,
          occurrence: entry.intent.params.answer_occurrence,
          state: entry.claimed ? "claimed" : entry.state,
          attempt: entry.attempt,
          attempts: entry.attempts,
          prior_uncertainty: entry.prior_uncertainty,
          ...(entry.evidence ? { reason: entry.evidence.reason } : {}),
          ...(entry.cli_received_at !== null
            ? { received_at: entry.cli_received_at }
            : {}),
        };
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
  const trim = (next: LedgerDocument, protectedIds: ReadonlySet<string>) => {
    for (const [rows, max] of [
      [next.changes, LEDGER_LIMITS.changes],
      [next.results, LEDGER_LIMITS.results],
      [next.asks, LEDGER_LIMITS.asks],
    ] as const) {
      let excess = rows.length - max;
      for (let i = 0; i < rows.length && excess > 0; ) {
        const row = rows[i]!;
        if (
          protectedIds.has(row.id) ||
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
  const ids: WorldIds = {
    issue: (kind) =>
      closing
        ? Promise.reject(new StorageWriteRejected("World storage is closing"))
        : client.request<string>({ type: "issue-id", kind }),
  };
  let bindingTail: Promise<void> = Promise.resolve();
  let captureCount = 0,
    captureBytes = 0;
  const bindingRequest = <T>(operation: BindingOperation): Promise<T> =>
    closing
      ? Promise.reject(new StorageWriteRejected("World storage is closing"))
      : bindingTail.then(() =>
          client.request<T>({ type: "binding", operation }),
        );
  const ledger: LedgerStore = {
    nextId: (kind) => ids.issue(kind),
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
        const declaredEffects =
          typeof effects === "function" ? effects() : effects;
        // A newly declared effect must not lose its domain record to this write's trim.
        trim(next, new Set(declaredEffects.map((effect) => effect.record_id)));
        const asks = diff(document.asks, next.asks);
        const changes = diff(document.changes, next.changes);
        const results = diff(document.results, next.results);
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
    runtimeStatus,
    profiles,
    ids,
    bindings: {
      settled: () => bindingTail,
      captureLegacy(captures) {
        if (closing)
          return Promise.reject(
            new StorageWriteRejected("World storage is closing"),
          );
        const captured = structuredClone(captures);
        if (
          new Set(captured.map((capture) => capture.key)).size !==
          captured.length
        )
          return Promise.reject(
            new StorageWriteRejected("Duplicate legacy binding keys"),
          );
        const admittedBytes = Buffer.byteLength(JSON.stringify(captured));
        if (
          captureCount >= STORAGE_BOUNDS.queuedOperations ||
          captureBytes + admittedBytes > STORAGE_BOUNDS.queuedBytes
        )
          return Promise.reject(
            new StorageWriteRejected(
              "World binding capture admission limit reached",
            ),
          );
        captureCount++;
        captureBytes += admittedBytes;
        const operation = bindingTail.then(async () => {
          const send = (operation: LegacyBindingOperation) =>
            client.request<void>({
              type: "binding",
              operation: { type: "legacy", operation },
            });
          // Page by bytes as well as count: a single record has at most 64 witnesses.
          const pages: LegacyBindingCapture[][] = [];
          let page: LegacyBindingCapture[] = [],
            bytes = 0;
          for (const capture of captured) {
            const size = Buffer.byteLength(JSON.stringify(capture));
            if (size > STORAGE_BOUNDS.requestBytes / 2)
              throw new StorageWriteRejected(
                "World binding capture is too large",
              );
            if (
              page.length &&
              (page.length >= 64 ||
                bytes + size > STORAGE_BOUNDS.requestBytes / 2)
            ) {
              pages.push(page);
              page = [];
              bytes = 0;
            }
            page.push(capture);
            bytes += size;
          }
          if (page.length) pages.push(page);
          await send({ type: "begin" });
          for (const page of pages)
            await send({
              type: "prepare",
              captures: page,
            });
          await send({ type: "plan" });
          for (const page of pages)
            await send({
              type: "put",
              keys: page.map((capture) => capture.key),
            });
          await send({ type: "finish" });
        });
        bindingTail = operation.finally(() => {
          captureCount--;
          captureBytes -= admittedBytes;
        });
        void bindingTail.catch(() => {}); // The caller observes failure; close still drains it.
        return operation;
      },
      create: (input) => bindingRequest({ type: "create", input }),
      get: (id) => bindingRequest({ type: "get", id }),
      list: (page = {}) => bindingRequest({ type: "list", page }),
      resolve: (id, event, current, expectedRevision) =>
        bindingRequest({
          type: "resolve",
          id,
          event,
          current,
          expectedRevision,
        }),
      remove: (id) => bindingRequest({ type: "remove", id }),
    },
    ledger,
    incarnation,
    outbox: {
      list: (kind, readyOnly) => refresh(undefined, kind, readyOnly),
      async notices(kind, after, limit = 60) {
        const page = await client.request<AttentionNotices>({
          type: "notices",
          kind,
          after,
          limit,
        });
        for (const entry of page.entries) remember(entry);
        return page;
      },
      beginDispatch: (id, attempt, fence) =>
        transition({ type: "begin-dispatch", id, attempt, fence }),
      acknowledge: (id, occurrence, attempt, actor) =>
        transition({ type: "acknowledge", id, occurrence, attempt, actor }),
      decide: (id, occurrence, attempt, action) =>
        transition({ type: "decide", id, occurrence, attempt, action }),
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
      profiles.close();
      runtimeStatus.close();
      closed = Promise.allSettled([tail, bindingTail]).then(() =>
        client.close(),
      );
      return closed;
    },
  };
}
