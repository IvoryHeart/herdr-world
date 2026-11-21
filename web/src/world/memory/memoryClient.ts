import { useSyncExternalStore } from "react";
import type {
  MemoryAction,
  MemoryCatalog,
  MemoryFailure,
  MemoryMutation,
  MemoryRead,
  MemorySearch,
  MemoryTarget,
} from "../../../../shared/memory";
import { bridge } from "../../api";
import {
  MEMORY_FIXTURE_AGENT_NAMES,
  MEMORY_FIXTURE_TARGET,
  memoryFixtureClient,
  memoryFixtureOn,
  memoryFixtureHasMemory,
} from "./memoryFixture";

/**
 * The browser's side of the memory API (docs/memory-api.md): every call
 * names its exact connection and generation in params, never a default, and
 * nothing read here is stored outside the page. Contents stay in component
 * state; only catalog metadata is cached, for the Town sign's counts.
 */

/** A client call takes up to four host requests of 15 s each. */
export const MEMORY_CALL_MS = 60_000;
/** A catalog this old is read again when a view asks. */
export const MEMORY_CATALOG_FRESH_MS = 5 * 60_000;

export type MemoryFilter = { workspace_id?: string; agent_id?: string };

export type MemoryClient = {
  list(target: MemoryTarget): Promise<MemoryCatalog>;
  search(
    target: MemoryTarget,
    query: string,
    filter?: MemoryFilter,
  ): Promise<MemorySearch>;
  read(
    target: MemoryTarget,
    sourceId: string,
    path: string,
  ): Promise<MemoryRead>;
  create(
    target: MemoryTarget,
    sourceId: string,
    path: string,
    content: string,
  ): Promise<MemoryMutation>;
  update(
    target: MemoryTarget,
    sourceId: string,
    path: string,
    revision: string,
    content: string,
  ): Promise<MemoryMutation>;
  remove(
    target: MemoryTarget,
    sourceId: string,
    path: string,
    revision: string,
  ): Promise<MemoryMutation>;
};

type Call = (
  action: MemoryAction,
  params: Record<string, unknown>,
) => Promise<unknown>;

/** A client over one `call` (the bridge, a test's or the fixture's). */
export function memoryClientOver(call: Call): MemoryClient {
  const at = (target: MemoryTarget) => ({
    connection_id: target.connection_id,
    connection_generation: target.connection_generation,
  });
  return {
    list: (target) => call("list", at(target)).then(catalogReply),
    search: (target, query, filter = {}) =>
      call("search", {
        ...at(target),
        query,
        ...filter,
      }) as Promise<MemorySearch>,
    read: (target, source_id, path) =>
      call("read", { ...at(target), source_id, path }) as Promise<MemoryRead>,
    create: (target, source_id, path, content) =>
      call("create", {
        ...at(target),
        source_id,
        path,
        content,
        user_action: true,
      }) as Promise<MemoryMutation>,
    update: (target, source_id, path, revision, content) =>
      call("update", {
        ...at(target),
        source_id,
        path,
        revision,
        content,
        user_action: true,
      }) as Promise<MemoryMutation>,
    remove: (target, source_id, path, revision) =>
      call("delete", {
        ...at(target),
        source_id,
        path,
        revision,
        user_action: true,
        confirmed: true,
      }) as Promise<MemoryMutation>,
  };
}

/**
 * A list reply the views can count: its lists are arrays. Anything else (a
 * server without the memory API, a synthetic host) is a failed read, never a
 * Town that cannot render.
 */
function catalogReply(reply: unknown): MemoryCatalog {
  const catalog = reply as Partial<MemoryCatalog> | null;
  const lists = ["projects", "agents", "sources", "entries"] as const;
  if (
    !catalog ||
    typeof catalog !== "object" ||
    lists.some((key) => !Array.isArray(catalog[key]))
  )
    throw new Error("invalid: The host's reply was not a memory catalog.");
  return {
    ...catalog,
    unsupported: Array.isArray(catalog.unsupported) ? catalog.unsupported : [],
    warnings: Array.isArray(catalog.warnings) ? catalog.warnings : [],
  } as MemoryCatalog;
}

const bridgeClient = memoryClientOver((action, params) =>
  bridge.call(`world.memory.${action}`, params, MEMORY_CALL_MS),
);

let override: MemoryClient | null = null;
/** For tests: answer every memory call with `client` (null restores). */
export function setMemoryClientForTests(client: MemoryClient | null) {
  override = client;
  catalogs.clear();
  pending.clear();
  hosts = [];
  emit();
}

/** The client: a test's, the `?memoryFixture` switch's, else the bridge. */
export function memoryClient(): MemoryClient {
  if (override) return override;
  if (memoryFixtureOn()) return memoryFixtureClient();
  return bridgeClient;
}

const CODES: readonly MemoryFailure[] = [
  "invalid",
  "unavailable",
  "not_found",
  "refused",
  "conflict",
  "too_large",
  "uncertain",
];

/** A failed call's memory code (from "code: message"), if it has one. */
export function memoryErrorCode(error: unknown): MemoryFailure | null {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const code = /^([a-z_]+):/.exec(text)?.[1];
  return CODES.find((known) => known === code) ?? null;
}

/** A failure in words, without the code prefix. */
export function memoryErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const plain = text.replace(/^[a-z_]+:\s*/, "");
  if (/timed? ?out|timeout/i.test(plain))
    return "The host did not answer in time.";
  return plain || "Memory is unavailable.";
}

/* ── Hosts and their catalogs ─────────────────────────────────────────── */

/**
 * A host the Library can read: its live connection and generation, and the
 * names World shows for its agents (pane ID → name).
 */
export type MemoryHostTarget = MemoryTarget & {
  label: string;
  names: Readonly<Record<string, string>>;
};

export type MemoryCatalogState =
  | { status: "loading"; catalog?: MemoryCatalog }
  | { status: "ready"; catalog: MemoryCatalog; at: number }
  | { status: "failed"; error: string; catalog?: MemoryCatalog; at: number };

const listeners = new Set<() => void>();
let hosts: readonly MemoryHostTarget[] = [];
const catalogs = new Map<string, MemoryCatalogState>();
let version = 0;
const emit = () => {
  version += 1;
  for (const listener of listeners) listener();
};
export const subscribeMemory = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const memoryTargetKey = (target: MemoryTarget) =>
  `${target.connection_id}\u0000${target.connection_generation}`;

/** The control plane publishes the hosts World can read now. */
export function publishMemoryHosts(next: readonly MemoryHostTarget[]) {
  const same =
    next.length === hosts.length &&
    next.every(
      (host, index) =>
        memoryTargetKey(host) === memoryTargetKey(hosts[index]!) &&
        host.label === hosts[index]!.label &&
        JSON.stringify(host.names) === JSON.stringify(hosts[index]!.names),
    );
  if (same) return;
  hosts = next;
  // A generation that went away never answers for the new one.
  const live = new Set(next.map(memoryTargetKey));
  for (const key of catalogs.keys()) if (!live.has(key)) catalogs.delete(key);
  emit();
}

const fixtureHosts: readonly MemoryHostTarget[] = [
  { ...MEMORY_FIXTURE_TARGET, names: MEMORY_FIXTURE_AGENT_NAMES },
];

/** The hosts to offer: the published ones, or the testing switch's one. */
export function memoryHosts(): readonly MemoryHostTarget[] {
  if (!override && memoryFixtureOn())
    return memoryFixtureHasMemory() ? fixtureHosts : [];
  return hosts;
}

export function memoryCatalogState(target: MemoryTarget) {
  return catalogs.get(memoryTargetKey(target)) ?? null;
}

const pending = new Map<string, Promise<void>>();

/**
 * Read a host's catalog: at most once per freshness window unless `force`
 * (the Library's open and its Refresh). A read already under way is shared,
 * so a caller waiting on it sees its result. A reply for a host whose
 * generation went away meanwhile is dropped.
 */
export function requestMemoryCatalog(
  target: MemoryTarget,
  { force = false, now = Date.now() }: { force?: boolean; now?: number } = {},
): Promise<void> {
  const key = memoryTargetKey(target);
  const running = pending.get(key);
  if (running) return running;
  const state = catalogs.get(key);
  if (
    !force &&
    state &&
    state.status !== "loading" &&
    now - state.at < MEMORY_CATALOG_FRESH_MS
  )
    return Promise.resolve();
  catalogs.set(key, { status: "loading", catalog: state?.catalog });
  emit();
  const current = () =>
    memoryHosts().some((host) => memoryTargetKey(host) === key);
  const job = memoryClient()
    .list(target)
    .then(
      (catalog) => {
        if (!current()) return;
        catalogs.set(key, { status: "ready", catalog, at: Date.now() });
      },
      (error: unknown) => {
        if (!current()) return;
        catalogs.set(key, {
          status: "failed",
          error: memoryErrorText(error),
          catalog: state?.catalog,
          at: Date.now(),
        });
      },
    )
    .finally(() => {
      pending.delete(key);
      emit();
    });
  pending.set(key, job);
  return job;
}

/** Re-renders on any host or catalog change; returns the store's version. */
export function useMemoryStore() {
  return useSyncExternalStore(subscribeMemory, () => version);
}
