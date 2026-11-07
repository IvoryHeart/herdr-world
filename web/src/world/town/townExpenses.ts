import { useEffect } from "react";
import type {
  UsageEntity,
  UsageTotal,
  WorldUsageSnapshot,
} from "../../../../shared/usage";
import { formatOfficeUsage } from "../officeObservability";
import {
  townHostHasData,
  townHostPartial,
  townUsageCounted,
  townUsagePrice,
  townUsageStore,
  useTownCurrentUsage,
  type TownCurrentUsage,
  type TownUsagePrice,
  type TownUsageStore,
  type TownUsageWindow,
} from "./townPlaceUsage";

/**
 * Town's expenses boards (#213): the city billboard by the town center and a
 * building's expenses on its reception board. A read model over the service's
 * harness usage (`world.usage.get`, docs/usage.md) with its honesty rules:
 *
 * - Totals are the service's own projections, one rollup level per figure.
 *   A host's total is its host rollup and its rooms are workspace rollups;
 *   levels are never added together. Usage tied to no room is computed from
 *   the counted entities, as the service counts a total.
 * - Stale, missing and unavailable entities are left out of totals; the
 *   board says stale numbers were left out.
 * - A null estimated cost stays null and says why: no price table, or models
 *   missing from it. It is never $0.
 * - A host with no readable harness has no data, which is never shown as 0.
 * - A read kept through failed refreshes, or from before the UTC day turned,
 *   is stale and shows no figures (`townUsageCurrent`).
 */

/** One figure: tokens, and the estimate with why it is null when it is. */
export type TownExpenseTotal = {
  tokens: number;
  /** Estimated from the operator's price table; null when unpriced. */
  costUsd: number | null;
  price: TownUsagePrice;
  /** Usage records counted; 0 means none recorded, not measured zero cost. */
  records: number;
};

/** What the figures leave out, said on the board. */
export type TownExpenseCoverage = {
  /** A harness was read only in part, or the read was cut short. */
  partial: boolean;
  /** Some numbers are stale and are not in the totals. */
  stale: boolean;
  /** Hosts with no readable harness: no data, not zero. */
  noDataHosts: number;
};

export type TownExpenseRoom = {
  workspaceId: string;
  generation: number;
  total: TownExpenseTotal;
};

type Waiting = { status: "loading" | "unavailable" | "stale" | "no-data" };

export type TownCityExpenses =
  | Waiting
  | {
      status: "ready";
      window: TownUsageWindow;
      total: TownExpenseTotal;
      /** Usage the service could not tie to a pane. */
      unattributed: TownExpenseTotal;
      coverage: TownExpenseCoverage;
    };

export type TownHostExpenses =
  | Waiting
  | {
      status: "ready";
      window: TownUsageWindow;
      total: TownExpenseTotal;
      /** The host's rooms by spend, most first, at most `TOWN_TOP_ROOMS`. */
      rooms: TownExpenseRoom[];
      /** Rooms with usage beyond the ones listed. */
      moreRooms: number;
      /** The host's usage the service could not tie to a room. */
      unattributed: TownExpenseTotal;
      coverage: TownExpenseCoverage;
    };

/** A reception's expenses list its three costliest rooms. */
export const TOWN_TOP_ROOMS = 3;

function figure(total: UsageTotal, counted: readonly UsageEntity[]) {
  return {
    tokens: total.total_tokens,
    costUsd: total.estimated_cost_usd,
    price: townUsagePrice(total.estimated_cost_usd, counted),
    records: total.records,
  } satisfies TownExpenseTotal;
}

/** Counted entities as one total, by the service's rule (totals.ts). */
function entityFigure(entities: readonly UsageEntity[]): TownExpenseTotal {
  const counted = entities.filter(townUsageCounted);
  let tokens = 0;
  let cost = 0;
  let unpriced = false;
  for (const entity of counted) {
    tokens += entity.total_tokens;
    if (entity.estimated_cost_usd === null) unpriced = true;
    else cost += entity.estimated_cost_usd;
  }
  const costUsd = counted.length && !unpriced ? cost : null;
  return {
    tokens,
    costUsd,
    price: townUsagePrice(costUsd, counted),
    records: counted.length,
  };
}

const hostKey = (connectionId: string, generation: number) =>
  JSON.stringify([connectionId, generation]);

function coverage(
  snapshot: WorldUsageSnapshot,
  owns: (target: {
    connection_id: string;
    connection_generation: number;
  }) => boolean,
): TownExpenseCoverage {
  const sources = snapshot.sources.filter(owns);
  const entities = snapshot.entities.filter(owns);
  const hosts = new Set(
    sources.map((s) => hostKey(s.connection_id, s.connection_generation)),
  );
  let noDataHosts = 0;
  for (const key of hosts) {
    const [connectionId, generation] = JSON.parse(key) as [string, number];
    if (!townHostHasData(snapshot, connectionId, generation)) noDataHosts++;
  }
  return {
    partial:
      snapshot.truncated ||
      sources.some((s) => s.state === "partial") ||
      entities.some((e) => e.state === "partial"),
    stale:
      sources.some((s) => s.state === "stale") ||
      entities.some((e) => e.state === "stale"),
    noDataHosts,
  };
}

const waiting = (state: TownCurrentUsage): Waiting | null => {
  if (state.status === "ready") return null;
  if (state.status === "failed") return { status: "unavailable" };
  if (state.status === "stale") return { status: "stale" };
  return { status: "loading" };
};

/** The whole World's expenses, for the city billboard. */
export function townCityExpenses(state: TownCurrentUsage): TownCityExpenses {
  const pending = waiting(state);
  if (pending || state.status !== "ready") return pending!;
  const { snapshot } = state;
  if (
    !snapshot.sources.some(
      (s) => s.state === "available" || s.state === "partial",
    )
  )
    return { status: "no-data" };
  const counted = snapshot.entities.filter(townUsageCounted);
  return {
    status: "ready",
    window: snapshot.window.kind,
    total: figure(snapshot.total, counted),
    unattributed: figure(
      snapshot.unattributed,
      counted.filter((e) => !e.pane_id),
    ),
    coverage: coverage(snapshot, () => true),
  };
}

/**
 * A host's runtime generation in the read: the newest the service reports
 * for that connection. Another connection's numbers are never used.
 */
function hostGeneration(snapshot: WorldUsageSnapshot, connectionId: string) {
  let generation: number | null = null;
  for (const source of snapshot.sources)
    if (
      source.connection_id === connectionId &&
      (generation === null || source.connection_generation > generation)
    )
      generation = source.connection_generation;
  return generation;
}

const spend = (a: TownExpenseRoom, b: TownExpenseRoom, byCost: boolean) =>
  (byCost ? b.total.costUsd! - a.total.costUsd! : 0) ||
  b.total.tokens - a.total.tokens;

/** One host's expenses, for its reception board. */
export function townHostExpenses(
  state: TownCurrentUsage,
  connectionId: string,
): TownHostExpenses {
  const pending = waiting(state);
  if (pending || state.status !== "ready") return pending!;
  const { snapshot } = state;
  const generation = hostGeneration(snapshot, connectionId);
  if (
    generation === null ||
    !townHostHasData(snapshot, connectionId, generation)
  )
    return { status: "no-data" };
  const owns = (target: {
    connection_id: string;
    connection_generation: number;
  }) =>
    target.connection_id === connectionId &&
    target.connection_generation === generation;
  const entities = snapshot.entities.filter(owns);
  const counted = entities.filter(townUsageCounted);
  const host = snapshot.rollups.find(
    (rollup) => rollup.level === "host" && owns(rollup),
  );
  const rooms: TownExpenseRoom[] = snapshot.rollups
    .filter(
      (rollup) =>
        rollup.level === "workspace" &&
        rollup.workspace_id !== null &&
        rollup.records > 0 &&
        owns(rollup),
    )
    .map((rollup) => ({
      workspaceId: rollup.workspace_id!,
      generation: rollup.connection_generation,
      total: figure(
        rollup,
        counted.filter((e) => e.workspace_id === rollup.workspace_id),
      ),
    }));
  // By cost when every room is priced, else by tokens: a null cost is not
  // the cheapest.
  const byCost = rooms.every((room) => room.total.costUsd !== null);
  rooms.sort((a, b) => spend(a, b, byCost));
  return {
    status: "ready",
    window: snapshot.window.kind,
    total: host ? figure(host, counted) : entityFigure([]),
    rooms: rooms.slice(0, TOWN_TOP_ROOMS),
    moreRooms: Math.max(0, rooms.length - TOWN_TOP_ROOMS),
    unattributed: entityFigure(entities.filter((e) => !e.workspace_id)),
    coverage: {
      ...coverage(snapshot, owns),
      partial:
        snapshot.truncated ||
        townHostPartial(snapshot, connectionId, generation) ||
        entities.some((e) => e.state === "partial"),
    },
  };
}

/** "$3.40": an estimate in US dollars, as the price table states rates. */
export function townUsd(value: number) {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  })}`;
}

/** Why a figure has no cost. */
export const townPriceNote = (price: Exclude<TownUsagePrice, "priced">) =>
  price === "no-table" ? "no price table" : "some models unpriced";

/** "$3.40 est.", or why there is no cost; null when nothing was recorded. */
export function townCostText(total: TownExpenseTotal) {
  if (!total.records) return null;
  return total.price === "priced" && total.costUsd !== null
    ? `${townUsd(total.costUsd)} est.`
    : townPriceNote(total.price === "priced" ? "unpriced" : total.price);
}

/** "1.2M tokens · $3.40 est.", or "none recorded" for no records. */
export function townExpenseText(total: TownExpenseTotal) {
  const cost = townCostText(total);
  return cost === null
    ? "none recorded"
    : `${formatOfficeUsage(total.tokens)} tokens · ${cost}`;
}

/** The notes under a board's figures: what its totals leave out. */
export function townCoverageNotes(
  coverage: TownExpenseCoverage,
  unattributed: TownExpenseTotal,
) {
  const notes: string[] = [];
  if (unattributed.records)
    notes.push(`${formatOfficeUsage(unattributed.tokens)} unattributed`);
  if (coverage.partial) notes.push("partial");
  if (coverage.stale) notes.push("stale data left out");
  if (coverage.noDataHosts)
    notes.push(
      `no data from ${coverage.noDataHosts} ${coverage.noDataHosts === 1 ? "host" : "hosts"}`,
    );
  return notes;
}

export const TOWN_WINDOW_LABEL: Record<TownUsageWindow, string> = {
  today: "Today",
  "7d": "7 days",
};

/** Boards re-read usage about once a minute while shown, and on focus. */
export const TOWN_EXPENSES_REFRESH_MS = 60_000;

/**
 * A window's usage as it may be shown now, read when the board mounts,
 * every minute while it is shown and when the page regains focus; never
 * while the page is hidden. The store holds requests to one per 30 seconds,
 * the service's interval.
 */
export function useTownExpensesUsage(store: TownUsageStore = townUsageStore()) {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") store.request();
    };
    refresh();
    const timer = window.setInterval(refresh, TOWN_EXPENSES_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [store]);
  return useTownCurrentUsage(store);
}
