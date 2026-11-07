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
  | { status: "loading" | "unavailable" | "none" }
  | {
      status: "ready";
      /** Estimated from the operator's price table; null when unpriced. */
      costUsd: number | null;
      tokens: number;
      /** Models used there, most tokens first. */
      models: string[];
      /** Some of the place's usage could not be read in full. */
      partial: boolean;
    };

/** The service refreshes usage at most every 30 seconds per runtime. */
const REFRESH_MS = 30_000;

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
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = () => this.state;

  /**
   * A card opened: read today's usage, at most once per refresh interval.
   * A failed read keeps the last numbers it had.
   */
  request() {
    const now = this.clock();
    if (this.pending || now - this.requestedAt < REFRESH_MS) return;
    this.requestedAt = now;
    this.pending = true;
    if (this.state.status !== "ready") this.set({ status: "loading" });
    void this.client.call("world.usage.get", { window: "today" }).then(
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

let shared: TownUsageStore | null = null;
export function townUsageStore() {
  shared ??= new TownUsageStore(bridge);
  return shared;
}

export function useTownUsage(store: TownUsageStore = townUsageStore()) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
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
  if (!usage || usage.rollup.records === 0) return { status: "none" };
  const byModel = new Map<string, number>();
  for (const entity of usage.entities)
    byModel.set(
      entity.model,
      (byModel.get(entity.model) ?? 0) + entity.total_tokens,
    );
  return {
    status: "ready",
    costUsd: usage.rollup.estimated_cost_usd,
    tokens: usage.rollup.total_tokens,
    models: [...byModel]
      .sort(([, left], [, right]) => right - left)
      .map(([model]) => model),
    partial:
      state.snapshot.truncated ||
      usage.entities.some((entity) => entity.state !== "available"),
  };
}
