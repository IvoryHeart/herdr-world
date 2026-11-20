import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import {
  usageRoleLabel,
  usageRunFacts,
  usageRunForPane,
  usageRuns,
} from "./usageModel";
import { useUsageAnalytics } from "./usageStore";
import "./agentUsageLine.css";

export type AgentUsagePane = {
  connectionId: string;
  generation: number;
  paneId: string;
};

/**
 * An agent's run on its cards (#1029): its role and item, tokens, calls and
 * largest prompt this run (for a harness World reads no log of, its time at
 * work and that tokens are not available), and what may be waste (a fixer's third round, a
 * near-full context). It shares the Usage screens' one run read; while that
 * read is not in it says nothing, and a pane with no run read says
 * "unknown", never a guess. `onOpen` makes it a button to the Usage screens.
 */
export function AgentUsageLine({
  pane,
  onOpen,
}: {
  pane: AgentUsagePane | null;
  onOpen?: (() => void) | null;
}) {
  const state = useUsageAnalytics("run", "7d", pane !== null);
  const runs = useMemo(
    () => (state.status === "ready" ? usageRuns(state.data) : []),
    [state],
  );
  if (!pane || state.status !== "ready") return null;
  const run = usageRunForPane(runs, pane);
  const body = run ? (
    <>
      <span className="agent-usage-facts">
        {run.role ? `${usageRoleLabel(run.role)} · ` : ""}
        {run.item.key === "none" ? "" : `${run.item.label} · `}
        {usageRunFacts(run)}
      </span>
      {run.flags.map((flag) => (
        <span key={flag} className="agent-usage-flag">
          <AlertTriangle size={12} aria-hidden="true" />
          {flag}
        </span>
      ))}
    </>
  ) : (
    <span className="agent-usage-facts">This run: usage unknown</span>
  );
  return onOpen ? (
    <button
      type="button"
      className="agent-usage"
      title="Open Usage"
      aria-label={`This run's usage: ${run ? `${usageRunFacts(run)}${run.flags.length ? `, ${run.flags.join(", ")}` : ""}` : "unknown"}. Open Usage`}
      onClick={onOpen}
    >
      {body}
    </button>
  ) : (
    <p className="agent-usage">{body}</p>
  );
}
