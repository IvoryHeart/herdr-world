import { useMemo } from "react";
import type { ApartmentResident } from "../../../../shared/apartments";
import {
  residentUsageGap,
  usageAgentFacts,
  usageAgentRows,
  usageSumRows,
} from "./usageModel";
import type { OpenUsage } from "./usageOpener";
import type { UsageReadState } from "./usageStore";
import "./agentUsageLine.css";

/**
 * A resident's week of usage in Apartments (#1101), worded as an agent card's
 * run line: time at work, waiting on you, and tokens or that its harness's
 * are not available. It reads the agent rows of the IDs the resident was
 * counted under; with none this week it says "usage unknown" and why
 * (residentUsageGap). While the read is not in it says nothing. With `onOpen` (Town is shown) every resident
 * opens Usage's Breakdown on that agent, even one with no usage this week:
 * Breakdown then says nothing was measured for it.
 */
export function ResidentUsageLine({
  resident,
  usage,
  onOpen,
}: {
  resident: Pick<
    ApartmentResident,
    "name" | "harness" | "move_out" | "usage_agent_ids"
  >;
  /** The one `agent`/7d read the Apartments window shares. */
  usage: UsageReadState;
  onOpen?: OpenUsage | null;
}) {
  const ids = resident.usage_agent_ids;
  const metrics = useMemo(() => {
    if (usage.status !== "ready" || !ids?.length) return null;
    const rows = usageAgentRows(usage.data, ids);
    return rows.length ? usageSumRows(rows) : null;
  }, [usage, ids]);
  if (usage.status !== "ready") return null;
  const why = metrics ? null : residentUsageGap(resident);
  const facts = usageAgentFacts(metrics, resident.harness, why);
  return onOpen ? (
    <button
      type="button"
      className="agent-usage apartments-usage"
      title="Open in Usage"
      aria-label={`${facts}. Open ${resident.name} in Usage`}
      onClick={() =>
        onOpen("breakdown", {
          ids: ids ?? [],
          label: resident.name,
          // Breakdown says itself when counted usage aged out of the week.
          why: ids?.length ? null : why,
        })
      }
    >
      <span className="agent-usage-facts">{facts}</span>
    </button>
  ) : (
    <p className="agent-usage apartments-usage">
      <span className="agent-usage-facts">{facts}</span>
    </p>
  );
}
