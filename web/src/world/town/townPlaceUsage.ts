import { useSyncExternalStore } from "react";
import { bridge } from "../../api";
import type {
  UsageEntity,
  UsageRollup,
  WorldUsageSnapshot,
} from "../../../../shared/usage";
import type { OfficeQualifiedTarget } from "../officeProjectionTypes";

/**
 * A room's or table's economy numbers for its card. The Town board's metrics
 * provider reports whole-town totals by model, with no place in them, so the
 * cards read the service's harness usage (`world.usage.get`, docs/usage.md):
 * today's tokens and estimated cost attributed to each Herdr workspace (a
 * room) and tab (a table), exactly as qualified by connection and generation.
 */
export type TownUsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; snapshot: WorldUsageSnapshot };

export type TownPlaceEconomy =
  | { status: "loading" | "unavailable" | "none" | "no-data" }
  | {
      status: "ready";
      /** Estimated from the operator's price table; null when unpriced. */
      costUsd: number | null;
      /** Why a null cost is null: no table at all, or models it lacks. */
      price: TownUsagePrice;
      tokens: number;
      /** Models used there, most tokens first. */
      models: string[];
      /** Some of the place's usage could not be read in full. */
      partial: boolean;
    };

/** The service refreshes usage at most every 30 seconds per runtime. */
const REFRESH_MS = 30_000;

/** `world.usage.get`'s windows: since UTC midnight, or the last 7 UTC days. */
export type TownUsageWindow = "today" | "7d";

/**
 * A total's estimate: priced, or null because the instance has no price
 * table, or because some of its models are not in the table. A null cost is
 * never shown as $0.
 */
export type TownUsagePrice = "priced" | "no-table" | "unpriced";

/** Entity states the service counts in current totals (totals.ts). */
export const townUsageCounted = (entity: UsageEntity) =>
  entity.state === "available" || entity.state === "partial";

/** Why a total's estimated cost is (or is not) null. */
export function townUsagePrice(
  cost: number | null,
  counted: readonly UsageEntity[],
): TownUsagePrice {
  if (cost !== null) return "priced";
  return counted.some((entity) => entity.price_table_version !== null)
    ? "unpriced"
    : "no-table";
}

/**
 * Whether any harness on a host could be read: available or partial. A host
 * with none (no source, or only missing, unavailable, stale or unsupported
 * ones) has no data, which is not zero usage.
 */
export function townHostHasData(
  snapshot: WorldUsageSnapshot,
  connectionId: string,
  generation: number,
) {
  return snapshot.sources.some(
    (source) =>
      source.connection_id === connectionId &&
      source.connection_generation === generation &&
      (source.state === "available" || source.state === "partial"),
  );
}

type UsageClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

export class TownUsageStore {
  private state: TownUsageState = { status: "idle" };
  private requestedAt = -Infinity;
  private pending = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: UsageClient,
    private readonly clock: () => number = Date.now,
    readonly window: TownUsageWindow = "today",
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = () => this.state;

  /**
   * A card opened: read the window's usage, at most once per refresh interval.
   * A failed read keeps the last numbers it had.
   */
  request() {
    const now = this.clock();
    if (this.pending || now - this.requestedAt < REFRESH_MS) return;
    this.requestedAt = now;
    this.pending = true;
    if (this.state.status !== "ready") this.set({ status: "loading" });
    void this.client.call("world.usage.get", { window: this.window }).then(
      (result) => {
        this.pending = false;
        const snapshot = result as WorldUsageSnapshot | null;
        if (snapshot?.version === 1 && Array.isArray(snapshot.rollups))
          this.set({ status: "ready", snapshot });
        else if (this.state.status !== "ready") this.set({ status: "failed" });
      },
      () => {
        this.pending = false;
        if (this.state.status !== "ready") this.set({ status: "failed" });
      },
    );
  }

  private set(state: TownUsageState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const shared = new Map<TownUsageWindow, TownUsageStore>();
/** The one store per window that every Town reader shares. */
export function townUsageStore(window: TownUsageWindow = "today") {
  let store = shared.get(window);
  if (!store)
    shared.set(window, (store = new TownUsageStore(bridge, Date.now, window)));
  return store;
}

export function useTownUsage(store: TownUsageStore = townUsageStore()) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Whether some harness on a host could be read only in part. */
export function townHostPartial(
  snapshot: WorldUsageSnapshot,
  connectionId: string,
  generation: number,
) {
  return snapshot.sources.some(
    (source) =>
      source.connection_id === connectionId &&
      source.connection_generation === generation &&
      source.state === "partial",
  );
}

/** A place's usage: a room is a Herdr workspace, a table a tab. */
export type TownUsagePlace = {
  kind: "room" | "desk";
  target: OfficeQualifiedTarget;
};

type PlaceUsage = { rollup: UsageRollup; entities: UsageEntity[] };
const indexes = new WeakMap<WorldUsageSnapshot, Map<string, PlaceUsage>>();

const placeKey = (
  level: "workspace" | "tab",
  connectionId: string,
  generation: number,
  nativeId: string | null,
) => JSON.stringify([level, connectionId, generation, nativeId]);

function index(snapshot: WorldUsageSnapshot) {
  let places = indexes.get(snapshot);
  if (places) return places;
  places = new Map();
  for (const rollup of snapshot.rollups) {
    if (rollup.level !== "workspace" && rollup.level !== "tab") continue;
    places.set(
      placeKey(
        rollup.level,
        rollup.connection_id,
        rollup.connection_generation,
        rollup.level === "workspace" ? rollup.workspace_id : rollup.tab_id,
      ),
      { rollup, entities: [] },
    );
  }
  for (const entity of snapshot.entities) {
    for (const [level, id] of [
      ["workspace", entity.workspace_id],
      ["tab", entity.tab_id],
    ] as const) {
      if (id === null) continue;
      places
        .get(
          placeKey(
            level,
            entity.connection_id,
            entity.connection_generation,
            id,
          ),
        )
        ?.entities.push(entity);
    }
  }
  indexes.set(snapshot, places);
  return places;
}

/** A room's or table's part of today's usage, for its card. */
export function townPlaceEconomy(
  state: TownUsageState,
  place: TownUsagePlace,
): TownPlaceEconomy {
  if (state.status === "idle" || state.status === "loading")
    return { status: "loading" };
  if (state.status === "failed") return { status: "unavailable" };
  const { target } = place;
  const usage = index(state.snapshot).get(
    placeKey(
      place.kind === "room" ? "workspace" : "tab",
      target.connectionId,
      target.generation,
      target.nativeId,
    ),
  );
  if (!usage || usage.rollup.records === 0)
    return townHostHasData(
      state.snapshot,
      target.connectionId,
      target.generation,
    )
      ? { status: "none" }
      : { status: "no-data" };
  const counted = usage.entities.filter(townUsageCounted);
  const byModel = new Map<string, number>();
  for (const entity of counted)
    byModel.set(
      entity.model,
      (byModel.get(entity.model) ?? 0) + entity.total_tokens,
    );
  return {
    status: "ready",
    costUsd: usage.rollup.estimated_cost_usd,
    price: townUsagePrice(usage.rollup.estimated_cost_usd, counted),
    tokens: usage.rollup.total_tokens,
    models: [...byModel]
      .sort(([, left], [, right]) => right - left)
      .map(([model]) => model),
    partial:
      state.snapshot.truncated ||
      usage.entities.some((entity) => entity.state !== "available") ||
      townHostPartial(state.snapshot, target.connectionId, target.generation),
  };
}
