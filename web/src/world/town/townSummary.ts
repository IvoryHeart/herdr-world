import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeRosterEntry,
} from "../herdrOfficeProjection";
import type { OfficeObservability } from "../officeObservability";
import type { TownCall } from "./TownRail";
import type { WorldAsk } from "../worldAsks";
import { officeReadModel, type OfficeStatusCounts } from "../officeReadModel";
import type { WorldAgentStatus } from "../worldObject";
import { townOutOfFuelRooms } from "./townOutOfFuel";
import type { AgentUsageStop } from "../../../../shared/usageStop";

/**
 * The Town summary: one read model behind the Town board sign, the phone
 * chip and the summary window (pm's Town summary scope, phase 1). It never
 * keeps its own attention list: "needs you" and recent finishes are the call
 * rail's calls, so every surface shows the same items and counts. Open
 * questions remain the shared ledger questions; the global needs-you count
 * includes them as separate items.
 */
export type TownSummary = {
  /**
   * Whole-town totals for the board and chip. Needs you and finished are the
   * rail's items; working, quiet and unknown add up every room of every
   * building, and `agents` is every agent in the town.
   */
  counts: TownSummaryCounts & { agents: number; buildings: number };
  needsYou: readonly TownSummaryItem[];
  asks: readonly WorldAsk[];
  /**
   * Unreviewed finishes, most recently active first. Their time is Herdr's
   * last session activity, not the finish itself: show it as "last active".
   */
  finished: readonly TownSummaryItem[];
  hosts: readonly TownSummaryHost[];
  spend: TownSummarySpend;
};

export type TownSummaryItem = {
  agent: OfficeAgent;
  hostLabel: string;
  roomKey: string;
  roomLabel: string;
  /** Epoch ms: waiting since, or a finish's last activity when known. */
  since: number | null;
};

/** A room's counts, in the shared display set. */
export type TownSummaryCounts = {
  needsYou: number;
  working: number;
  finished: number;
  quiet: number;
  unknown: number;
  /** Stopped on a usage limit (townOutOfFuel.ts), apart from quiet. */
  outOfFuel: number;
};

export type TownSummaryHost = {
  key: string;
  /** The host's connection, which qualifies its usage and limits. */
  connectionId: string;
  label: string;
  /** Offline or stale hosts show when they were last seen. */
  stale: boolean;
  counts: TownSummaryCounts;
  rooms: readonly {
    key: string;
    label: string;
    counts: TownSummaryCounts;
  }[];
};

export type TownSummarySpend =
  | { available: false }
  | {
      available: true;
      totalUsd: number | null;
      observedAt: number;
      providerId: string | null;
      models: readonly { model: string; costUsd: number | null }[];
    };

const emptyCounts = (): TownSummaryCounts => ({
  needsYou: 0,
  working: 0,
  finished: 0,
  quiet: 0,
  unknown: 0,
  outOfFuel: 0,
});

const COUNT_KEYS = Object.keys(emptyCounts()) as (keyof TownSummaryCounts)[];

/** Herdr's statuses in the summary's display set. */
const COUNT_OF: Readonly<Record<WorldAgentStatus, keyof TownSummaryCounts>> = {
  blocked: "needsYou",
  working: "working",
  done: "finished",
  idle: "quiet",
  unknown: "unknown",
};

function addCounts(into: TownSummaryCounts, from: TownSummaryCounts) {
  for (const key of COUNT_KEYS) into[key] += from[key];
}

/** Every agent a set of counts holds. */
export function townSummaryAgents(counts: TownSummaryCounts): number {
  return COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0);
}

const roomContributions = new WeakMap<OfficeStatusCounts, TownSummaryCounts>();
const topologies = new WeakMap<
  HerdrOfficeProjection,
  { hosts: TownSummaryHost[]; totals: TownSummaryCounts }
>();

function summaryTopology(office: HerdrOfficeProjection) {
  const previous = topologies.get(office);
  if (previous) return previous;
  const read = officeReadModel(office);
  // Out-of-fuel agents are presented idle; count them apart from quiet.
  const fuel = townOutOfFuelRooms(office);
  const byHost = new Map<string, TownSummaryHost["rooms"][number][]>();
  const totals = emptyCounts();
  for (const room of office.roomRoster) {
    const raw = read.roomCounts.get(room.key);
    let counts = raw ? roomContributions.get(raw) : undefined;
    if (!counts) {
      counts = emptyCounts();
      if (raw) {
        for (const status of Object.keys(COUNT_OF) as WorldAgentStatus[])
          counts[COUNT_OF[status]] += raw[status];
        roomContributions.set(raw, counts);
      }
    }
    const out = fuel.get(room.key) ?? 0;
    if (out) counts = { ...counts, quiet: counts.quiet - out, outOfFuel: out };
    addCounts(totals, counts);
    let rooms = byHost.get(room.hostKey);
    if (!rooms) byHost.set(room.hostKey, (rooms = []));
    rooms.push({ key: room.key, label: room.displayLabel, counts });
  }
  const hosts = office.hosts.map((host): TownSummaryHost => {
    const rooms = byHost.get(host.key) ?? [];
    const counts = emptyCounts();
    for (const room of rooms) addCounts(counts, room.counts);
    return {
      key: host.key,
      connectionId: host.connectionId,
      label: host.accessibleLabel ?? host.displayLabel,
      stale: host.stale,
      counts,
      rooms,
    };
  });
  const result = { hosts, totals };
  topologies.set(office, result);
  return result;
}

export function townSummary(
  office: HerdrOfficeProjection,
  calls: readonly TownCall[],
  observability: OfficeObservability,
  /** Herdr's last session activity of an agent (epoch ms), when known. */
  activityOf: (agent: OfficeAgent) => number | undefined = () => undefined,
  asks: readonly WorldAsk[] = [],
): TownSummary {
  const item = (call: TownCall, since: number | null): TownSummaryItem => ({
    agent: call.agent,
    hostLabel: call.hostLabel,
    roomKey: call.roomKey,
    roomLabel: call.roomLabel,
    since,
  });
  const needsYou = calls
    .filter((call) => call.kind === "blocked")
    .map((call) => item(call, call.since));
  const finished = calls
    .filter((call) => call.kind === "done")
    .map((call) => item(call, activityOf(call.agent) ?? null))
    .sort((left, right) => (right.since ?? 0) - (left.since ?? 0));
  // Complete room contributions were counted cooperatively before publication.
  // Asks, metrics and the display clock do not recount raw agent topology.
  const { hosts, totals } = summaryTopology(office);
  const available =
    observability.health !== "unavailable" && observability.sourceCount > 0;
  return {
    counts: {
      needsYou: needsYou.length + asks.length,
      working: totals.working,
      finished: finished.length,
      quiet: totals.quiet,
      unknown: totals.unknown,
      outOfFuel: totals.outOfFuel,
      agents: townSummaryAgents(totals),
      buildings: hosts.length,
    },
    needsYou,
    asks,
    finished,
    hosts,
    spend: available
      ? {
          available: true,
          totalUsd: observability.totalCostUsd,
          observedAt: observability.observedAt,
          providerId: observability.providerId,
          models: observability.models.map(({ model, costUsd }) => ({
            model,
            costUsd,
          })),
        }
      : { available: false },
  };
}

/**
 * One room's or table's summary, counted as the Town board counts the town:
 * needs you and finished are the summary's own rail items there, working,
 * quiet and unknown its agents, and `agents` every agent there.
 */
export type TownPlaceSummary = {
  counts: TownSummaryCounts & { agents: number };
  /** A table's agents that are out of fuel, for its card to name. */
  fuel: readonly { label: string; stop: AgentUsageStop }[];
};

export type TownPlace = { kind: "room" | "desk"; key: string };

const roomIndexes = new WeakMap<
  readonly TownSummaryHost[],
  ReadonlyMap<string, TownSummaryCounts>
>();
const deskIndexes = new WeakMap<
  readonly OfficeRosterEntry[],
  ReadonlyMap<string, TownSummaryCounts>
>();
const deskFuel = new WeakMap<
  readonly OfficeRosterEntry[],
  ReadonlyMap<string, TownPlaceSummary["fuel"]>
>();

/**
 * A room's or table's part of the Town summary, for its card: the room
 * counts the summary lists, or one pass over the roster by table, with the
 * summary's own needs-you and finished items there.
 */
export function townPlaceSummary(
  summary: TownSummary,
  office: HerdrOfficeProjection,
  place: TownPlace,
): TownPlaceSummary {
  let counts: TownSummaryCounts | undefined;
  let fuel: TownPlaceSummary["fuel"] = [];
  if (place.kind === "room") {
    let index = roomIndexes.get(summary.hosts);
    if (!index) {
      index = new Map(
        summary.hosts.flatMap((host) =>
          host.rooms.map((room) => [room.key, room.counts] as const),
        ),
      );
      roomIndexes.set(summary.hosts, index);
    }
    counts = index.get(place.key);
  } else {
    let index = deskIndexes.get(office.roster);
    if (!index) {
      const desks = new Map<string, TownSummaryCounts>();
      const stopped = new Map<string, TownPlaceSummary["fuel"][number][]>();
      for (const { agent } of office.roster) {
        if (agent.deskKey === null) continue;
        let desk = desks.get(agent.deskKey);
        if (!desk) desks.set(agent.deskKey, (desk = emptyCounts()));
        if (agent.usageStop) {
          desk.outOfFuel += 1;
          let list = stopped.get(agent.deskKey);
          if (!list) stopped.set(agent.deskKey, (list = []));
          list.push({ label: agent.displayLabel, stop: agent.usageStop });
        } else desk[COUNT_OF[agent.semanticStatus]] += 1;
      }
      deskIndexes.set(office.roster, (index = desks));
      deskFuel.set(office.roster, stopped);
    }
    counts = index.get(place.key);
    fuel = deskFuel.get(office.roster)?.get(place.key) ?? [];
  }
  const here = (item: TownSummaryItem) =>
    place.kind === "room"
      ? item.roomKey === place.key
      : item.agent.deskKey === place.key;
  const agents = counts ?? emptyCounts();
  return {
    counts: {
      needsYou: summary.needsYou.filter(here).length,
      working: agents.working,
      finished: summary.finished.filter(here).length,
      quiet: agents.quiet,
      unknown: agents.unknown,
      outOfFuel: agents.outOfFuel,
      agents: townSummaryAgents(agents),
    },
    fuel,
  };
}

/** "12 m ago", "3 h ago", or "just now", for summary ages. */
export function townSummaryAge(since: number | null, now: number): string {
  if (since === null) return "";
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}
