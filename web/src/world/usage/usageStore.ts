import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../../api";
import type {
  UsageAnalyticsGroup,
  WorldUsageAnalytics,
} from "../../../../shared/usageAnalytics";
import { usageFixtureClient } from "./usageFixture";

/**
 * One `world.usage.analytics` read per grouping and window, shared by the
 * observatory, the Usage screens and agent cards. The browser reads only this
 * API: the analysers behind it (harness logs today) are the service's one
 * source seam, so new ones need no change here.
 */
export type UsageReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; data: WorldUsageAnalytics; receivedAt: number };

/** The service refreshes usage at most every 30 seconds per runtime. */
export const USAGE_REFRESH_MS = 30_000;
/** A read kept through failed refreshes is not shown after this. */
export const USAGE_MAX_AGE_MS = 5 * 60_000;

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

export class UsageAnalyticsStore {
  private state: UsageReadState = { status: "idle" };
  private requestedAt = -Infinity;
  private pending = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: Client,
    readonly group: UsageAnalyticsGroup,
    readonly window: "today" | "7d",
    readonly clock: () => number = Date.now,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = () => this.state;

  /** Read again, at most once per refresh interval. */
  request() {
    const now = this.clock();
    if (this.pending || now - this.requestedAt < USAGE_REFRESH_MS) return;
    this.requestedAt = now;
    this.pending = true;
    if (this.state.status !== "ready") this.set({ status: "loading" });
    void this.client
      .call("world.usage.analytics", {
        window: this.window,
        group_by: this.group,
      })
      .then(
        (result) => {
          this.pending = false;
          const data = result as WorldUsageAnalytics | null;
          if (data?.version === 1 && Array.isArray(data.rows))
            this.set({ status: "ready", data, receivedAt: this.clock() });
          else if (this.state.status !== "ready")
            this.set({ status: "failed" });
        },
        () => {
          this.pending = false;
          if (this.state.status !== "ready") this.set({ status: "failed" });
        },
      );
  }

  private set(state: UsageReadState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const stores = new Map<string, UsageAnalyticsStore>();
let client: Client | null = null;

/** The shared store for one grouping and window. */
export function usageAnalyticsStore(
  group: UsageAnalyticsGroup,
  window: "today" | "7d" = "7d",
) {
  const key = `${window}:${group}`;
  let store = stores.get(key);
  if (!store) {
    client ??= usageFixtureClient(bridge);
    store = new UsageAnalyticsStore(client, group, window);
    stores.set(key, store);
  }
  return store;
}

/** For tests: drop the shared stores and client. */
export function resetUsageStores() {
  stores.clear();
  client = null;
}

/**
 * A read as it may be shown now: one older than `USAGE_MAX_AGE_MS` reads as
 * failed, never as current numbers.
 */
export function usageCurrent(state: UsageReadState, now: number) {
  return state.status === "ready" && now - state.receivedAt > USAGE_MAX_AGE_MS
    ? ({ status: "failed" } as const)
    : state;
}

/** The read, refreshed on mount and every 30 seconds while `active`. */
export function useUsageAnalytics(
  group: UsageAnalyticsGroup,
  window: "today" | "7d" = "7d",
  active = true,
  store = usageAnalyticsStore(group, window),
): UsageReadState {
  useEffect(() => {
    if (!active) return;
    store.request();
    const timer = globalThis.setInterval(
      () => store.request(),
      USAGE_REFRESH_MS,
    );
    return () => globalThis.clearInterval(timer);
  }, [store, active]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return usageCurrent(state, store.clock());
}
