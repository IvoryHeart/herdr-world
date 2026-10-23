import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";
import type { OfficeObservability } from "../officeObservability";
import type { TownCall } from "./TownRail";
import type { WorldAsk } from "../worldAsks";
import { officeReadModel, type OfficeStatusCounts } from "../officeReadModel";

/**
 * The Town summary: one read model behind the Town board sign, the phone
 * chip and the summary window (pm's Town summary scope, phase 1). It never
 * keeps its own attention list: "needs you" and recent finishes are the call
 * rail's calls, so every surface shows the same items and counts. Open
 * questions remain the shared ledger questions; the global needs-you count
 * includes them as separate items.
 */
export type TownSummary = {
  counts: { needsYou: number; working: number; finished: number };
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
};

export type TownSummaryHost = {
  key: string;
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
});

const roomContributions = new WeakMap<OfficeStatusCounts, TownSummaryCounts>();
const topologies = new WeakMap<
  HerdrOfficeProjection,
  { hosts: TownSummaryHost[]; working: number }
>();

function summaryTopology(office: HerdrOfficeProjection) {
  const previous = topologies.get(office);
  if (previous) return previous;
  const read = officeReadModel(office);
  const byHost = new Map<string, TownSummaryHost["rooms"][number][]>();
  let working = 0;
  for (const room of office.roomRoster) {
    const raw = read.roomCounts.get(room.key);
    let counts = raw ? roomContributions.get(raw) : undefined;
    if (!counts) {
      counts = raw
        ? {
            needsYou: raw.blocked,
            working: raw.working,
            finished: raw.done,
            quiet: raw.idle,
            unknown: raw.unknown,
          }
        : emptyCounts();
      if (raw) roomContributions.set(raw, counts);
    }
    working += counts.working;
    let rooms = byHost.get(room.hostKey);
    if (!rooms) byHost.set(room.hostKey, (rooms = []));
    rooms.push({ key: room.key, label: room.displayLabel, counts });
  }
  const hosts = office.hosts.map((host): TownSummaryHost => {
    const rooms = byHost.get(host.key) ?? [];
    const counts = emptyCounts();
    for (const room of rooms)
      for (const key of Object.keys(counts) as (keyof TownSummaryCounts)[])
        counts[key] += room.counts[key];
    return {
      key: host.key,
      label: host.accessibleLabel ?? host.displayLabel,
      stale: host.stale,
      counts,
      rooms,
    };
  });
  const result = { hosts, working };
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
  const { hosts, working } = summaryTopology(office);
  const available =
    observability.health !== "unavailable" && observability.sourceCount > 0;
  return {
    counts: {
      needsYou: needsYou.length + asks.length,
      working,
      finished: finished.length,
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

/** "12 m ago", "3 h ago", or "just now", for summary ages. */
export function townSummaryAge(since: number | null, now: number): string {
  if (since === null) return "";
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}
