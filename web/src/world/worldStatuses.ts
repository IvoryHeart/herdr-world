import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../api";
import type { AsksClient } from "./worldAsks";

/**
 * Progress rows any program reports with `herdr-world status` (the service's
 * World ledger, server/src/world/world-cli-status.ts). Town's Summary shows
 * them as the Work strip, fetched alone (`world.statuses.get`) only when a
 * change notice says a row changed. Rows interrupt nobody; a row's
 * `--needs-you` question arrives through the asks store like any other.
 */

export type WorkStatusState =
  | "working"
  | "blocked"
  | "done"
  | "idle"
  | "failed";

export type WorkStatus = {
  id: string;
  key: string;
  line: string;
  state: WorkStatusState;
  group: string;
  phase?: string;
  progress?: number;
  url?: string;
  needs_you?: boolean;
  /** When the row was first reported and last updated. */
  at: number;
  updated_at: number;
  /** When the row turns stale without another update. */
  stale_at: number;
  actor: { label: string; verified: boolean; name?: string };
};

/** A stale row drops off this long after it turned stale (as the service). */
export const WORK_STATUS_DROP_MS = 24 * 60 * 60_000;

const NONE: readonly WorkStatus[] = [];

export class WorldStatusesStore {
  private revision = -1;
  private rows: readonly WorkStatus[] = NONE;
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  private users = 0;
  private epoch = 0;

  constructor(
    private readonly client: AsksClient,
    /** Testing only: rows shown after the service's (see `workDemoRows`). */
    private readonly extra: readonly WorkStatus[] = NONE,
  ) {}

  get = () => this.rows;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start() {
    this.users += 1;
    if (this.unlisten.length) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (
          control.type === "world_ledger_changed" &&
          control.statuses === true &&
          (control.revision ?? 0) > this.revision
        )
          void this.refresh();
      }),
      this.client.onStatus((status) => {
        // A restarted service may count revisions from the start again.
        if (status === "disconnected") this.epoch++;
        if (status === "connected") {
          this.epoch++;
          this.revision = -1;
          void this.refresh();
        }
      }),
    ];
    void this.refresh();
  }

  stop() {
    this.users = Math.max(0, this.users - 1);
    if (this.users) return;
    this.epoch++;
    for (const off of this.unlisten) off();
    this.unlisten = [];
  }

  async refresh() {
    const epoch = this.epoch;
    try {
      const next = (await this.client.call("world.statuses.get")) as {
        revision: number;
        statuses: WorkStatus[];
      } | null;
      if (
        epoch !== this.epoch ||
        !next ||
        !Array.isArray(next.statuses) ||
        next.revision < this.revision
      )
        return;
      this.revision = next.revision;
      this.rows = [...next.statuses, ...this.extra];
      for (const listener of this.listeners) listener();
    } catch {
      // Rows come back with the next change or reconnect.
    }
  }
}

/**
 * Testing-only switch: `?work-status-demo=1` adds synthetic rows (one of
 * them already stale) for this page load, and the page drops the parameter
 * at once. Nothing is written to the service.
 */
export function workDemoRows(now = Date.now()): WorkStatus[] {
  if (typeof window === "undefined") return [];
  const url = new URL(window.location.href);
  if (!url.searchParams.has("work-status-demo")) return [];
  url.searchParams.delete("work-status-demo");
  window.history.replaceState(window.history.state, "", url);
  const actor = { label: "Demo program", verified: false };
  const row = (
    key: string,
    fields: Partial<WorkStatus> & Pick<WorkStatus, "line" | "state" | "group">,
    updatedAgo: number,
    ttl = 60 * 60_000,
  ): WorkStatus => ({
    id: `demo-${key}`,
    key,
    at: now - updatedAgo,
    updated_at: now - updatedAgo,
    stale_at: now - updatedAgo + ttl,
    actor,
    ...fields,
  });
  return [
    row(
      "demo-42",
      {
        line: "Demo: fixing the login form",
        state: "working",
        group: "Demo crew",
        phase: "review",
        progress: 60,
        url: "https://example.invalid/42",
      },
      3 * 60_000,
    ),
    row(
      "demo-43",
      {
        line: "Demo: needs a decision on the API name",
        state: "blocked",
        group: "Demo crew",
        needs_you: true,
      },
      60_000,
    ),
    row(
      "demo-nightly",
      { line: "Demo: nightly build", state: "failed", group: "Demo CI" },
      90 * 60_000,
      30 * 60_000,
    ),
    row(
      "demo-deploy",
      { line: "Demo: deployed to staging", state: "done", group: "Demo CI" },
      20 * 60_000,
    ),
  ];
}

let shared: WorldStatusesStore | null = null;
export function sharedStatusesStore() {
  shared ??= new WorldStatusesStore(bridge, workDemoRows());
  return shared;
}

/** Status rows while the caller is shown. */
export function useWorldStatuses(
  store: WorldStatusesStore = sharedStatusesStore(),
) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
