import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  HelpCircle,
  Hourglass,
  X,
} from "lucide-react";
import "../board/boardAppearance.css";
import "../board/workLens.css";
import "./usageLens.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorldUsageAnalytics } from "../../../../shared/usageAnalytics";
import { useLayer } from "../../layerStack";
import type { WorldObject } from "../worldObject";
import { UsageBreakdown } from "./UsageBreakdown";
import {
  townFuelGauges,
  townFuelNotes,
  townLimitSourceName,
  townResetTime,
  townSeenAge,
} from "../town/townLimits";
import {
  USAGE_WORK,
  USAGE_WORK_LABEL,
  usageByItem,
  usageByRole,
  usageConcurrency,
  usageCount,
  usageHarnessName,
  usageHourLabel,
  usagePaces,
  usagePaceText,
  usageRoleLabel,
  usageRunFacts,
  usageRuns,
  usageWeekPeaks,
  type UsageConcurrency,
  type UsagePace,
  type UsagePaceVerdict,
  type UsageRunView,
} from "./usageModel";
import type { UsageAgentFilter } from "./usageOpener";
import { useUsageAnalytics, type UsageReadState } from "./usageStore";

export type UsageTab = "budget" | "runs" | "tokens" | "breakdown";
const TABS: [UsageTab, string][] = [
  ["budget", "Budget"],
  ["runs", "Runs at once"],
  ["tokens", "Tokens"],
  ["breakdown", "Breakdown"],
];

/**
 * Usage (#1029): where time, tokens and budget go, per harness, role, item
 * and run, and per agent, project, room and day, from `world.usage.analytics`
 * (docs/usage-analytics.md). Town's observatory opens it. It is a layer:
 * Escape, Back or a press outside closes it. Numbers it has no reading for
 * say "unknown". `world` names agents and rooms; without it they are
 * "Earlier agent" and "Earlier room". `initialFilter` opens Breakdown on
 * one agent (a resident of Apartments, #1101) until it is cleared.
 */
export function UsageLens({
  initialTab = "budget",
  initialFilter = null,
  onClose,
  anchor,
  world,
}: {
  initialTab?: UsageTab;
  initialFilter?: UsageAgentFilter | null;
  onClose(): void;
  anchor?: () => Element | null;
  world?: WorldObject;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  useLayer(true, onClose, {
    element: () => sectionRef.current,
    anchors: () => [anchor?.() ?? null],
  });
  const [tab, setTab] = useState<UsageTab>(initialTab);
  const [filter, setFilter] = useState(initialFilter);
  const state = useUsageAnalytics("run", "7d");
  const now = useNow();
  useEffect(() => {
    sectionRef.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={sectionRef}
      className="work-lens town-work usage-lens"
      aria-label="Usage"
      data-tab={tab}
    >
      <header className="work-lens-head">
        <div className="work-lens-tabs" role="tablist" aria-label="Usage">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`usage-tab-${id}`}
              aria-controls="usage-panel"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="work-lens-icon"
          aria-label="Close Usage"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div
        id="usage-panel"
        className="usage-panel"
        role="tabpanel"
        aria-labelledby={`usage-tab-${tab}`}
      >
        <UsageBody
          tab={tab}
          state={state}
          now={now}
          world={world}
          filter={filter}
          onClearFilter={() => setFilter(null)}
        />
      </div>
    </section>
  );
}

/** The clock for "seen … ago" and pace wording, ticking every 30 s. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 30_000);
    return () => globalThis.clearInterval(timer);
  }, []);
  return now;
}

function UsageBody({
  tab,
  state,
  now,
  world,
  filter,
  onClearFilter,
}: {
  tab: UsageTab;
  state: UsageReadState;
  now: number;
  world?: WorldObject;
  filter: UsageAgentFilter | null;
  onClearFilter(): void;
}) {
  if (state.status !== "ready")
    return (
      <p className="work-lens-note" role="status">
        {state.status === "failed"
          ? "Usage could not be read just now; World tries again every 30 seconds."
          : "Reading usage…"}
      </p>
    );
  const { data } = state;
  if (tab === "budget") return <BudgetTab data={data} now={now} />;
  if (tab === "runs") return <RunsTab data={data} />;
  if (tab === "breakdown")
    return (
      <UsageBreakdown
        runs={usageRuns(data)}
        world={world}
        filter={filter}
        onClearFilter={onClearFilter}
      />
    );
  return <TokensTab data={data} />;
}

// ── Budget ──────────────────────────────────────────────────────────────

const VERDICT_ICON: Record<UsagePaceVerdict, ReactNode> = {
  reached: <Ban size={15} aria-hidden="true" />,
  early: <AlertTriangle size={15} aria-hidden="true" />,
  "on-track": <CheckCircle2 size={15} aria-hidden="true" />,
  unused: <Hourglass size={15} aria-hidden="true" />,
  "too-soon": <Clock size={15} aria-hidden="true" />,
  unknown: <HelpCircle size={15} aria-hidden="true" />,
};

function BudgetTab({ data, now }: { data: WorldUsageAnalytics; now: number }) {
  const paces = usagePaces(data.limits, now);
  const notes = townFuelNotes(data.limits, townFuelGauges(data.limits, now));
  const runs = usageRuns(data);
  const harnesses = [...new Set(paces.map((p) => p.harness))];
  return (
    <div className="usage-budget">
      <p className="usage-lead">
        {harnesses.length
          ? "Each harness's subscription windows: how much is used, and where this pace ends by the reset."
          : "No limit reading yet. Claude and Codex record their limits as agents answer; the first reading appears here."}
      </p>
      <div className="usage-cards">
        {harnesses.map((harness) => {
          const list = paces.filter((p) => p.harness === harness);
          const first = list[0]!;
          const live = runs.filter((r) => r.harness === harness && r.live);
          const limit = data.limits.find(
            (l) => l.harness === harness && l.observed_at === first.observedAt,
          );
          return (
            <article
              key={harness}
              className="usage-card"
              aria-label={`${first.name} budget`}
            >
              <h3>
                {first.name}
                <span>
                  {live.length
                    ? `${live.length} at work now`
                    : "none at work now"}
                </span>
              </h3>
              {list.map((pace) => (
                <PaceRow key={pace.label} pace={pace} now={now} />
              ))}
              <p className="usage-foot">
                Seen {townSeenAge(first.observedAt, now)}
                {limit?.source ? ` · ${townLimitSourceName(limit.source)}` : ""}
              </p>
            </article>
          );
        })}
        {notes.map((note) => (
          <article key={note.harness} className="usage-card">
            <h3>
              {note.name}
              <span>not available</span>
            </h3>
            <p className="usage-foot">{note.reason}</p>
          </article>
        ))}
      </div>
      <p className="usage-foot">
        This week: {usageCount(data.total.total_tokens.value)} tokens over{" "}
        {runs.length} runs. A pace line marks where even use would be now.
      </p>
    </div>
  );
}

function PaceRow({ pace, now }: { pace: UsagePace; now: number }) {
  const length = (pace.minutes ?? 0) * 60_000;
  const even =
    pace.resetsAt !== null && length > 0 && !pace.stale
      ? Math.min(100, Math.max(0, 100 - ((pace.resetsAt - now) / length) * 100))
      : null;
  const used = pace.verdict === "reached" ? 100 : pace.used;
  return (
    <div className="usage-pace" data-verdict={pace.verdict}>
      <div className="usage-pace-head">
        <span className="usage-pace-label">{pace.label}</span>
        <span className="usage-pace-value">
          {pace.stale
            ? "stale"
            : used === null
              ? "unknown"
              : pace.verdict === "reached"
                ? "used up"
                : `${used}% used`}
        </span>
      </div>
      <div
        className="usage-meter"
        role="meter"
        aria-label={`${pace.name} ${pace.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pace.stale || used === null ? undefined : used}
        aria-valuetext={
          pace.stale || used === null ? "unknown" : `${used}% used`
        }
      >
        {pace.stale || used === null ? null : (
          <span className="usage-meter-fill" style={{ width: `${used}%` }} />
        )}
        {even === null ? null : (
          <span
            className="usage-meter-even"
            style={{ left: `${even}%` }}
            title="Even use would be here now"
          />
        )}
      </div>
      <p className="usage-verdict">
        {VERDICT_ICON[pace.verdict]}
        {usagePaceText(pace, now)}
      </p>
      {pace.resetsAt !== null &&
      pace.verdict !== "reached" &&
      pace.verdict !== "on-track" &&
      pace.verdict !== "too-soon" &&
      pace.verdict !== "unused" ? (
        <p className="usage-foot">Resets {townResetTime(pace.resetsAt)}</p>
      ) : null}
    </div>
  );
}

// ── Runs at once ────────────────────────────────────────────────────────

function RunsTab({ data }: { data: WorldUsageAnalytics }) {
  const runs = useMemo(() => usageRuns(data), [data]);
  const at = useMemo(() => usageConcurrency(runs, data), [runs, data]);
  const week = useMemo(() => usageWeekPeaks(runs, data), [runs, data]);
  const [table, setTable] = useState(false);
  if (!runs.length)
    return (
      <p className="work-lens-note">
        No runs this week: World saw no agent at work and no harness log shows
        one.
      </p>
    );
  return (
    <div className="usage-runs">
      <p className="usage-lead">
        The most runs going at the same moment in each hour of the last 24,
        split into building (worker, fixer) and reviewing or checking (reviewer,
        checker). A run is going from one response to the next while they are at
        most ten minutes apart, and while World sees its agent working.
      </p>
      <Legend />
      {at.harnesses.map((harness) => (
        <HourChart key={harness} harness={harness} at={at} />
      ))}
      <p className="usage-foot">
        Busiest hour this week:{" "}
        {at.harnesses
          .map((harness) => {
            const peak = week.get(harness);
            return peak
              ? `${usageHarnessName(harness)} ${peak.count} at once (${townResetTime(peak.start)})`
              : `${usageHarnessName(harness)} unknown`;
          })
          .join("; ")}
        .
      </p>
      <button
        type="button"
        className="work-lens-setup"
        aria-expanded={table}
        onClick={() => setTable(!table)}
      >
        {table ? "Hide table" : "Show as table"}
      </button>
      {table ? <HourTable at={at} /> : null}
    </div>
  );
}

function Legend() {
  return (
    <ul className="usage-legend" aria-label="Legend">
      {USAGE_WORK.map((work) => (
        <li key={work}>
          <span className="usage-swatch" data-work={work} aria-hidden="true" />
          {USAGE_WORK_LABEL[work]}
        </li>
      ))}
    </ul>
  );
}

function HourChart({ harness, at }: { harness: string; at: UsageConcurrency }) {
  const [hover, setHover] = useState<number | null>(null);
  const name = usageHarnessName(harness);
  const peak = at.peaks.get(harness);
  const scale = Math.max(1, at.max);
  const shown = hover === null ? null : at.hours[hover];
  const counts = shown?.counts.get(harness);
  return (
    <figure className="usage-chart" aria-label={`${name} runs at once by hour`}>
      <figcaption>
        {name}
        <span>
          {peak
            ? `up to ${peak.count} at once, at ${usageHourLabel(peak.start)}`
            : "no runs in the last 24 hours"}
        </span>
      </figcaption>
      <div className="usage-plot" style={{ "--usage-max": scale } as never}>
        <span
          className="usage-gridline"
          data-value={scale}
          aria-hidden="true"
        />
        {at.hours.map((hour, index) => {
          const c = hour.counts.get(harness);
          const total = c ? c.building + c.checking + c.other : 0;
          return (
            <div
              key={hour.start}
              className="usage-col"
              tabIndex={0}
              style={{ "--i": index } as never}
              aria-label={`${usageHourLabel(hour.start)}: ${total} ${name} runs${
                c
                  ? `, ${c.building} building, ${c.checking} reviewing or checking, ${c.other} other`
                  : ""
              }`}
              onPointerEnter={() => setHover(index)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
            >
              <div className="usage-stack">
                {USAGE_WORK.map((work) =>
                  c?.[work] ? (
                    <span
                      key={work}
                      data-work={work}
                      style={{ height: `${(c[work] / scale) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
        {shown ? (
          <div
            className="usage-tip"
            role="status"
            style={{ "--i": hover } as never}
          >
            <strong>{usageHourLabel(shown.start)}</strong>
            {counts ? (
              USAGE_WORK.filter((w) => counts[w]).map((w) => (
                <span key={w}>
                  <i data-work={w} aria-hidden="true" />
                  {counts[w]} {USAGE_WORK_LABEL[w].toLowerCase()}
                </span>
              ))
            ) : (
              <span>no runs</span>
            )}
          </div>
        ) : null}
      </div>
      <div className="usage-axis" aria-hidden="true">
        {at.hours.map((hour, index) =>
          index % 6 === 0 ? (
            <span key={hour.start} style={{ "--i": index } as never}>
              {usageHourLabel(hour.start)}
            </span>
          ) : null,
        )}
        <span style={{ "--i": 23 } as never}>now</span>
      </div>
    </figure>
  );
}

function HourTable({ at }: { at: UsageConcurrency }) {
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <caption>Runs at once by hour</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            {at.harnesses.map((h) => (
              <th key={h} scope="col">
                {usageHarnessName(h)} building / checking / other
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {at.hours.map((hour) => (
            <tr key={hour.start}>
              <th scope="row">{usageHourLabel(hour.start)}</th>
              {at.harnesses.map((h) => {
                const c = hour.counts.get(h);
                return (
                  <td key={h}>
                    {c ? `${c.building} / ${c.checking} / ${c.other}` : "0"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tokens ──────────────────────────────────────────────────────────────

function TokensTab({ data }: { data: WorldUsageAnalytics }) {
  const runs = useMemo(() => usageRuns(data), [data]);
  const roles = useMemo(() => usageByRole(runs), [runs]);
  const items = useMemo(() => usageByItem(runs).slice(0, 12), [runs]);
  const live = runs.filter((r) => r.live);
  const heavy = runs.filter((r) => !r.live).slice(0, 8);
  if (!runs.length)
    return (
      <p className="work-lens-note">
        No runs this week: World saw no agent at work and no harness log shows
        one. Time per agent, project, room and day is under Breakdown.
      </p>
    );
  return (
    <div className="usage-tokens">
      <section aria-label="Heaviest runs" className="usage-section">
        <h3>Running now</h3>
        {live.length ? (
          <ul className="usage-run-list">
            {live.map((run) => (
              <RunCard key={run.key} run={run} />
            ))}
          </ul>
        ) : (
          <p className="usage-foot">No run answered in the last 10 minutes.</p>
        )}
        <h3>Heaviest this week</h3>
        <ul className="usage-run-list">
          {heavy.map((run) => (
            <RunCard key={run.key} run={run} />
          ))}
        </ul>
      </section>
      <section aria-label="Tokens by role" className="usage-section">
        <h3>By role</h3>
        <div className="usage-table-wrap">
          <table className="usage-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Runs</th>
                <th scope="col">Tokens</th>
                <th scope="col">Typical run</th>
                <th scope="col">Typical calls</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.label} data-work={role.work}>
                  <th scope="row">
                    <span
                      className="usage-swatch"
                      data-work={role.work}
                      aria-hidden="true"
                    />
                    {role.label}
                  </th>
                  <td>{role.runs}</td>
                  <td>{usageCount(role.tokens)}</td>
                  <td>{usageCount(role.perRun)}</td>
                  <td>{usageCount(role.callsPerRun)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>By item</h3>
        <ul className="usage-items">
          {items.map((item) => (
            <li key={item.item.key}>
              <span className="usage-item-label">
                {item.item.label}
                {item.live ? <em>now</em> : null}
              </span>
              <span className="usage-item-tokens">
                {usageCount(item.tokens)}
              </span>
              <span className="usage-item-roles">
                {item.runs} {item.runs === 1 ? "run" : "runs"}:{" "}
                {item.roles
                  .map(
                    (r) => `${usageRoleLabel(r.role).toLowerCase()} ${r.runs}`,
                  )
                  .join(", ")}
              </span>
              {item.fixerRounds > 1 ? (
                <span className="usage-flag">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {item.fixerRounds} fixer rounds
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RunCard({ run }: { run: UsageRunView }) {
  return (
    <li
      className="usage-run"
      data-work={run.work}
      data-flagged={run.flags.length > 0}
    >
      <p className="usage-run-title">
        <span
          className="usage-swatch"
          data-work={run.work}
          aria-hidden="true"
        />
        {run.item.label} · {usageRoleLabel(run.role).toLowerCase()} · {run.name}
      </p>
      <p className="usage-run-facts">
        {usageRunFacts(run)}
        {run.context
          ? ` · context ${
              run.context.percent === null
                ? `${usageCount(run.context.used)} of unknown`
                : `${run.context.percent}%`
            }`
          : ""}
      </p>
      {run.flags.length ? (
        <p className="usage-flag">
          <AlertTriangle size={13} aria-hidden="true" />
          {run.flags.join("; ")}
        </p>
      ) : null}
    </li>
  );
}
