import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  UsageAnalyticsGroup,
  UsageAnalyticsMetrics,
  UsageAnalyticsRow,
  UsageMetric,
  WorldUsageAnalytics,
} from "../../../../shared/usageAnalytics";
import { usageReadsTokens } from "../../../../shared/usageHarnesses";
import { agentName } from "../deskAgentLabels";
import type { WorldObject } from "../worldObject";
import {
  usageCount,
  usageDuration,
  usageAgentRows,
  usageHarnessName,
  usageSumRows,
  type UsageRunView,
} from "./usageModel";
import type { UsageAgentFilter } from "./usageOpener";
import { useUsageAnalytics, type UsageReadState } from "./usageStore";

type Group = Exclude<UsageAnalyticsGroup, "run">;
const GROUPS: [Group, string][] = [
  ["agent", "Agent"],
  ["project", "Project"],
  ["room", "Room"],
  ["day", "Day"],
];

/**
 * Usage per agent, project, room and day (#1029): time at work and waiting
 * on you that World measured, tokens and cost the harness logs record, and
 * pull requests. A number World has no reading for says "unknown"; a number
 * only some of whose sources were read says "partly read". `filter` narrows
 * it to one agent (a resident, #1101): its rows by agent and their total,
 * until cleared.
 */
export function UsageBreakdown({
  runs,
  world,
  filter = null,
  onClearFilter,
}: {
  runs: readonly UsageRunView[];
  world?: WorldObject;
  filter?: UsageAgentFilter | null;
  onClearFilter?: () => void;
}) {
  const [chosen, setGroup] = useState<Group>("agent");
  const group = filter ? "agent" : chosen;
  const state = useUsageAnalytics(group, "7d");
  return (
    <div className="usage-breakdown">
      <p className="usage-lead">
        {filter
          ? `The last seven days of ${filter.label}`
          : `The last seven days by ${group}`}
        : time World saw at work and waiting on you, tokens and cost from the
        harness logs, and pull requests.
      </p>
      {filter ? (
        <p className="usage-filter">
          <span>
            Agent: <strong>{filter.label}</strong>
          </span>
          <button
            type="button"
            className="work-lens-icon"
            aria-label="Show every agent"
            title="Show every agent"
            onClick={onClearFilter}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : (
        <div className="usage-group" role="group" aria-label="Group by">
          {GROUPS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={group === id}
              onClick={() => setGroup(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <BreakdownTable
        state={state}
        group={group}
        world={world}
        filter={filter}
      />
      <Coverage runs={runs} state={state} />
    </div>
  );
}

function BreakdownTable({
  state,
  group,
  world,
  filter,
}: {
  state: UsageReadState;
  group: Group;
  world?: WorldObject;
  filter: UsageAgentFilter | null;
}) {
  const rows = useMemo(
    () =>
      state.status !== "ready"
        ? []
        : filter
          ? sorted(
              { ...state.data, rows: usageAgentRows(state.data, filter.ids) },
              group,
            )
          : sorted(state.data, group),
    [state, group, filter],
  );
  if (state.status !== "ready")
    return (
      <p className="work-lens-note" role="status">
        {state.status === "failed"
          ? "Usage could not be read just now; World tries again every 30 seconds."
          : "Reading usage…"}
      </p>
    );
  const { data } = state;
  if (!rows.length)
    return (
      <p className="work-lens-note">
        {filter
          ? `Nothing measured for ${filter.label} this week: World keeps seven days, and finds no run of this agent in them.`
          : "Nothing measured this week: World saw no agent at work and no harness log could be read."}
      </p>
    );
  return (
    <div className="usage-table-wrap">
      <table className="usage-table usage-breakdown-table">
        <thead>
          <tr>
            <th scope="col">{GROUPS.find(([id]) => id === group)![1]}</th>
            <th scope="col">At work</th>
            <th scope="col">Waiting on you</th>
            <th scope="col">Tokens</th>
            <th scope="col">Cost</th>
            <th scope="col">PRs opened / merged</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = usageRowLabel(row, group, data, world);
            return (
              <tr key={row.key}>
                <th scope="row">
                  {filter && label === "Earlier agent" ? filter.label : label}
                </th>
                <Cells metrics={row} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{filter ? "This agent" : "This week"}</th>
            <Cells metrics={filter ? usageSumRows(rows) : data.total} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Cells({ metrics }: { metrics: UsageAnalyticsMetrics }) {
  return (
    <>
      <td>{metricText(metrics.active_ms, usageDuration)}</td>
      <td>{metricText(metrics.waiting_on_you_ms, usageDuration)}</td>
      <td>{metricText(metrics.total_tokens, usageCount)}</td>
      <td>{usageCostText(metrics)}</td>
      <td>
        {metricText(metrics.prs_opened, String)} /{" "}
        {metricText(metrics.prs_merged, String)}
      </td>
    </>
  );
}

function metricText(metric: UsageMetric, format: (value: number) => string) {
  if (metric.value === null) return "unknown";
  return metric.coverage === "partial"
    ? `${format(metric.value)} (partly read)`
    : format(metric.value);
}

/** Cost the harness reported, else World's estimate from list prices. */
export function usageCostText(metrics: UsageAnalyticsMetrics) {
  const money = (value: number) =>
    `$${value < 10 ? value.toFixed(2) : Math.round(value)}`;
  if (metrics.reported_cost_usd.value !== null)
    return metricText(metrics.reported_cost_usd, money);
  if (metrics.estimated_cost_usd.value !== null)
    return `est. ${metricText(metrics.estimated_cost_usd, money)}`;
  return "unknown";
}

function sorted(data: WorldUsageAnalytics, group: Group) {
  const rows = [...data.rows];
  if (group === "day")
    return rows.sort((a, b) =>
      (b.dimension ?? "").localeCompare(a.dimension ?? ""),
    );
  return rows.sort(
    (a, b) =>
      (b.active_ms.value ?? 0) +
        (b.waiting_on_you_ms.value ?? 0) -
        ((a.active_ms.value ?? 0) + (a.waiting_on_you_ms.value ?? 0)) ||
      (b.total_tokens.value ?? -1) - (a.total_tokens.value ?? -1),
  );
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A row's name: what World calls that agent, project, room or day now. */
export function usageRowLabel(
  row: UsageAnalyticsRow,
  group: Group,
  data: WorldUsageAnalytics,
  world?: WorldObject,
) {
  const id = row.identity;
  if (group === "day")
    return row.dimension
      ? dayFormat.format(Date.parse(row.dimension))
      : "Unknown day";
  if (group === "project")
    return row.dimension === null
      ? "No project"
      : (data.projects.find((p) => p.id === row.dimension)?.label ??
          "Earlier project");
  if (row.dimension === null || !id)
    return group === "agent" ? "No agent" : "No room";
  if (group === "agent") {
    const leaf = world?.leaves.find(
      (l) =>
        l.connectionId === id.connection_id &&
        l.generation === id.connection_generation &&
        l.pane.pane_id === id.pane_id,
    );
    return leaf ? agentName(leaf) : "Earlier agent";
  }
  const space = world?.spaces.find(
    (s) =>
      s.connectionId === id.connection_id &&
      s.generation === id.connection_generation &&
      s.nativeId === id.workspace_id,
  );
  return space?.label ?? "Earlier room";
}

/** Per harness, what World could read: the reader seam's answer. */
function Coverage({
  runs,
  state,
}: {
  runs: readonly UsageRunView[];
  state: UsageReadState;
}) {
  const harnesses = [...new Set(runs.map((r) => r.harness))].sort();
  const prs =
    state.status === "ready" ? state.data.coverage.pull_requests : null;
  return (
    <section aria-label="What World can read" className="usage-section">
      <h3>What World can read</h3>
      <ul className="usage-coverage">
        {harnesses.map((harness) => (
          <li key={harness}>
            <strong>{usageHarnessName(harness)}</strong>{" "}
            {usageReadsTokens(harness)
              ? "tokens, calls and cost from its session logs; time at work and waiting from World."
              : "tokens and cost not available: it keeps no log World reads. World measures its time at work and waiting, and its runs."}
          </li>
        ))}
        {harnesses.length ? null : <li>No harness at work this week.</li>}
        <li>
          <strong>Pull requests</strong>{" "}
          {prs === "partial"
            ? "from GitHub, for work World linked to an agent."
            : "unknown: GitHub is not connected or could not be read."}
        </li>
      </ul>
    </section>
  );
}
