import { useSyncExternalStore } from "react";
import {
  PULL_REQUEST_LANES,
  TICKET_LANES,
  WORLD_SOURCE_IDS,
  type WorkItem,
  type WorkLink,
  type WorldSourceId,
  type WorldSourceStatus,
  type WorldSourcesSnapshot,
} from "../../../shared/worldSources";

/**
 * The browser's view of World's built-in sources (GitHub, Jira): one shared
 * snapshot, refreshed from the service while any view shows it. The service
 * bounds the real requests; this only asks for what it last saw.
 */

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const SOURCES_PATH = "/api/world/sources";
const POLL_MS = 60_000;
const MAX_ITEMS = 500;
const MAX_LINKS = 2_000;
const LANES = new Set<string>([...PULL_REQUEST_LANES, ...TICKET_LANES]);

export const EMPTY_WORLD_SOURCES: WorldSourcesSnapshot = {
  observedAt: 0,
  sources: [],
  items: [],
  links: [],
};

export async function fetchWorldSources(
  fetchImpl: FetchLike = fetch,
  refresh = false,
): Promise<WorldSourcesSnapshot> {
  const response = await fetchImpl(
    refresh ? `${SOURCES_PATH}/refresh` : SOURCES_PATH,
    {
      method: refresh ? "POST" : "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) throw new Error(await responseError(response));
  return parseWorldSources(await response.json());
}

export async function updateWorldSource(
  id: WorldSourceId,
  settings: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<WorldSourcesSnapshot> {
  const response = await fetchImpl(`${SOURCES_PATH}/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(settings),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const snapshot = parseWorldSources(await response.json());
  worldSourcesStore.publish(snapshot);
  return snapshot;
}

/** Decode the service's snapshot, dropping anything malformed. */
export function parseWorldSources(value: unknown): WorldSourcesSnapshot {
  const data = record(value);
  const sources = (Array.isArray(data.sources) ? data.sources : [])
    .map(parseStatus)
    .filter((entry): entry is WorldSourceStatus => entry !== null);
  const items = (Array.isArray(data.items) ? data.items : [])
    .slice(0, MAX_ITEMS)
    .map(parseItem)
    .filter((entry): entry is WorkItem => entry !== null);
  const keys = new Set(items.map((item) => item.key));
  const links = (Array.isArray(data.links) ? data.links : [])
    .slice(0, MAX_LINKS)
    .map(record)
    .flatMap((link): WorkLink[] =>
      text(link.connectionId) &&
      text(link.paneId) &&
      typeof link.itemKey === "string" &&
      keys.has(link.itemKey) &&
      (link.via === "branch" || link.via === "reported")
        ? [
            {
              connectionId: link.connectionId as string,
              paneId: link.paneId as string,
              itemKey: link.itemKey,
              via: link.via,
            },
          ]
        : [],
    );
  return {
    observedAt: number(data.observedAt),
    sources,
    items,
    links,
  };
}

function parseStatus(value: unknown): WorldSourceStatus | null {
  const entry = record(value);
  if (!(WORLD_SOURCE_IDS as readonly unknown[]).includes(entry.id)) return null;
  if (
    !["connected", "not_connected", "error", "disabled"].includes(
      entry.state as string,
    )
  )
    return null;
  const config = record(entry.config);
  return {
    id: entry.id as WorldSourceId,
    label: text(entry.label) ?? String(entry.id),
    enabled: entry.enabled !== false,
    state: entry.state as WorldSourceStatus["state"],
    detail: text(entry.detail) ?? "",
    checkedAt: number(entry.checkedAt),
    lastSuccessAt:
      entry.lastSuccessAt === null ? null : number(entry.lastSuccessAt),
    itemCount: number(entry.itemCount),
    config:
      config.kind === "jira"
        ? {
            kind: "jira",
            site: text(config.site),
            email: text(config.email),
            jql: text(config.jql) ?? "",
            tokenSet: config.tokenSet === true,
          }
        : { kind: "github" },
  };
}

function parseItem(value: unknown): WorkItem | null {
  const item = record(value);
  const key = text(item.key);
  const url = text(item.url);
  if (
    !key ||
    !url ||
    !/^https:\/\//u.test(url) ||
    !(WORLD_SOURCE_IDS as readonly unknown[]).includes(item.source) ||
    !["pull_request", "issue", "ticket"].includes(item.kind as string) ||
    !LANES.has(item.lane as string)
  )
    return null;
  const optionalText = (name: string) =>
    text(item[name]) ? { [name]: text(item[name]) } : {};
  return {
    key,
    source: item.source as WorldSourceId,
    kind: item.kind as WorkItem["kind"],
    ref: text(item.ref) ?? key,
    title: text(item.title) ?? "",
    url,
    lane: item.lane as WorkItem["lane"],
    status: text(item.status) ?? "",
    roles: (Array.isArray(item.roles) ? item.roles : []).filter(
      (role): role is WorkItem["roles"][number] =>
        ["author", "reviewer", "assignee", "watcher"].includes(role as string),
    ),
    updatedAt: number(item.updatedAt),
    ...(Number.isSafeInteger(item.number)
      ? { number: item.number as number }
      : {}),
    ...optionalText("repo"),
    ...optionalText("branch"),
    ...optionalText("headRepo"),
    ...(typeof item.draft === "boolean" ? { draft: item.draft } : {}),
    ...(["pass", "fail", "pending", "none"].includes(item.checks as string)
      ? { checks: item.checks as WorkItem["checks"] }
      : {}),
    ...(["approved", "changes_requested", "review_required", "none"].includes(
      item.review as string,
    )
      ? { review: item.review as WorkItem["review"] }
      : {}),
    ...(["mergeable", "conflicting", "unknown"].includes(
      item.mergeable as string,
    )
      ? { mergeable: item.mergeable as WorkItem["mergeable"] }
      : {}),
  };
}

/** Each agent pane's linked items, keyed by connection and pane. */
export function workItemsByPane(
  snapshot: WorldSourcesSnapshot,
): ReadonlyMap<string, WorkItem[]> {
  const items = new Map(snapshot.items.map((item) => [item.key, item]));
  const byPane = new Map<string, WorkItem[]>();
  for (const link of snapshot.links) {
    const item = items.get(link.itemKey);
    if (!item) continue;
    const key = paneKey(link.connectionId, link.paneId);
    const list = byPane.get(key) ?? [];
    if (!list.includes(item)) list.push(item);
    byPane.set(key, list);
  }
  return byPane;
}

export const paneKey = (connectionId: string, paneId: string) =>
  `${connectionId}\0${paneId}`;

type Listener = () => void;

/** One poll for every view; it stops when nothing is subscribed. */
class WorldSourcesStore {
  #snapshot = EMPTY_WORLD_SOURCES;
  #listeners = new Set<Listener>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight: Promise<void> | null = null;
  #fetch: FetchLike = (input, init) => fetch(input, init);

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#start();
    return () => {
      this.#listeners.delete(listener);
      if (!this.#listeners.size) this.#stop();
    };
  };

  snapshot = () => this.#snapshot;

  publish(snapshot: WorldSourcesSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  refresh(force = false) {
    if (this.#inFlight && !force) return this.#inFlight;
    const task = fetchWorldSources(this.#fetch, force)
      .then((snapshot) => this.publish(snapshot))
      .catch(() => {
        // The service is unreachable; keep the last snapshot.
      })
      .finally(() => {
        if (this.#inFlight === task) this.#inFlight = null;
      });
    this.#inFlight = task;
    return task;
  }

  /** Tests: use a fake service. */
  useFetch(fetchImpl: FetchLike) {
    this.#fetch = fetchImpl;
  }

  #start() {
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  #stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}

export const worldSourcesStore = new WorldSourcesStore();

export function useWorldSources(): WorldSourcesSnapshot {
  return useSyncExternalStore(
    worldSourcesStore.subscribe,
    worldSourcesStore.snapshot,
    worldSourcesStore.snapshot,
  );
}

async function responseError(response: Response) {
  try {
    const body = record(await response.json());
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Fall through to the status text.
  }
  return `Sources request failed (${response.status})`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value.slice(0, 2_000) : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
