import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";
import type { OfficeObservability } from "../officeObservability";
import type { WorldAgentStatus } from "../worldObject";
import type { TownCall } from "./TownRail";

/**
 * The Town summary: one read model behind the Town board sign, the phone
 * chip and the summary window (pm's Town summary scope, phase 1). It never
 * keeps its own attention list: "needs you" and recent finishes are the call
 * rail's calls, so every surface shows the same items and counts.
 */
export type TownSummary = {
  counts: { needsYou: number; working: number; finished: number };
  needsYou: readonly TownSummaryItem[];
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

const COUNT_OF: Record<WorldAgentStatus, keyof TownSummaryCounts> = {
  blocked: "needsYou",
  working: "working",
  done: "finished",
  idle: "quiet",
  unknown: "unknown",
};

const emptyCounts = (): TownSummaryCounts => ({
  needsYou: 0,
  working: 0,
  finished: 0,
  quiet: 0,
  unknown: 0,
});

export function townSummary(
  office: HerdrOfficeProjection,
  calls: readonly TownCall[],
  observability: OfficeObservability,
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
    .map((call) => item(call, call.agent.lastActivityAt ?? null))
    .sort((left, right) => (right.since ?? 0) - (left.since ?? 0));
  // Room and host counts come from the whole roster, not the drawn desks.
  const roomCounts = new Map<string, TownSummaryCounts>();
  let working = 0;
  for (const { agent, roomKey } of office.roster) {
    const counts = roomCounts.get(roomKey) ?? emptyCounts();
    counts[COUNT_OF[agent.semanticStatus]] += 1;
    roomCounts.set(roomKey, counts);
    if (agent.semanticStatus === "working") working += 1;
  }
  const hosts = office.hosts.map((host): TownSummaryHost => {
    const rooms = office.rooms
      .filter((room) => room.hostKey === host.key)
      .map((room) => ({
        key: room.key,
        label: room.accessibleLabel ?? room.displayLabel,
        counts: roomCounts.get(room.key) ?? emptyCounts(),
      }));
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
  const available =
    observability.health !== "unavailable" && observability.sourceCount > 0;
  return {
    counts: {
      needsYou: needsYou.length,
      working,
      finished: finished.length,
    },
    needsYou,
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
