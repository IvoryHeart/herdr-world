import type {
  UsageEntity,
  UsageSummary,
  WorldUsageSnapshot,
} from "../../../shared/usage";
import { usageRollups, usageTotal } from "./totals";

/** Summaries account for every collected row, before any transport limits. */
export function summarizeUsage(entities: UsageEntity[]): UsageSummary {
  return {
    total: usageTotal(entities),
    unattributed: usageTotal(entities.filter((e) => !e.pane_id)),
    rollups: usageRollups(entities),
  };
}

/** Keep city and host balances intact even when detail exceeds the RPC budget. */
export function boundUsageDetails(snapshot: WorldUsageSnapshot) {
  if (snapshot.entities.length > 128) {
    snapshot.entities = snapshot.entities.slice(0, 128);
    snapshot.details_truncated = true;
  }
  const summaries = [snapshot, ...(snapshot.today ? [snapshot.today] : [])];
  const order = { host: 0, workspace: 1, tab: 2, pane: 3 };
  for (const summary of summaries)
    summary.rollups.sort((a, b) => order[a.level] - order[b.level]);
  // Halve optional detail in bounded steps, keeping host rollups (at most 16).
  // No total is recalculated from the shortened lists.
  while (Buffer.byteLength(JSON.stringify(snapshot)) > 768 * 1024) {
    snapshot.details_truncated = true;
    if (snapshot.entities.length) {
      snapshot.entities.length = Math.floor(snapshot.entities.length / 2);
      continue;
    }
    for (const summary of summaries) {
      const hosts = summary.rollups.filter((r) => r.level === "host").length;
      summary.rollups.length =
        hosts + Math.floor((summary.rollups.length - hosts) / 2);
    }
  }
}
