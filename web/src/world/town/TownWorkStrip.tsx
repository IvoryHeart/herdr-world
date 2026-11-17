import { AgentMark } from "../../components/AgentMark";
import type { AgentMarkKind } from "../agentMarks";
import {
  useWorldStatuses,
  WORK_STATUS_DROP_MS,
  type WorkStatus,
  type WorkStatusState,
} from "../worldStatuses";
import { townSummaryAge } from "./townSummary";

/** Each reported state as the shared agent marks show it. */
const MARKS: Record<WorkStatusState, { kind: AgentMarkKind; word: string }> = {
  working: { kind: "working", word: "Working" },
  blocked: { kind: "needs", word: "Blocked" },
  done: { kind: "done", word: "Done" },
  idle: { kind: "idle", word: "Idle" },
  failed: { kind: "offline", word: "Failed" },
};

/**
 * Town Summary's Work strip: rows any program reports with `herdr-world
 * status`, grouped by `--group` in first-reported order. Stale rows say how
 * long ago they last changed; a row a day past stale is gone. No rows, no
 * strip.
 */
export function TownWorkStrip({
  rows,
  now,
}: {
  rows: readonly WorkStatus[];
  now: number;
}) {
  const shown = rows.filter((row) => now < row.stale_at + WORK_STATUS_DROP_MS);
  if (!shown.length) return null;
  const groups = new Map<string, WorkStatus[]>();
  for (const row of shown) {
    const group = groups.get(row.group);
    if (group) group.push(row);
    else groups.set(row.group, [row]);
  }
  return (
    <section aria-labelledby="town-summary-work" className="town-work">
      <h3 id="town-summary-work">
        Work <span>{shown.length}</span>
      </h3>
      {[...groups].map(([group, entries]) => (
        <div key={group} className="town-work-group">
          <h4>{group}</h4>
          <ul>
            {entries.map((row) => (
              <WorkRow key={row.id} row={row} now={now} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function WorkRow({ row, now }: { row: WorkStatus; now: number }) {
  const mark = MARKS[row.state] ?? MARKS.idle;
  const stale = now >= row.stale_at;
  const age = townSummaryAge(row.updated_at, now);
  const detail = [
    row.key,
    row.phase,
    row.progress === undefined ? undefined : `${row.progress}%`,
    stale
      ? `stale · last update ${age}`
      : age === "just now"
        ? "updated just now"
        : `updated ${age}`,
  ].filter(Boolean);
  return (
    <li
      className="town-summary-item town-work-row"
      data-state={row.state}
      data-stale={stale || undefined}
    >
      <AgentMark kind={mark.kind} label={mark.word} />
      <div>
        <strong>
          {row.url ? (
            <a href={row.url} target="_blank" rel="noopener noreferrer">
              {row.line}
            </a>
          ) : (
            row.line
          )}
          {row.needs_you ? " · needs you" : ""}
        </strong>
        <small>{detail.join(" · ")}</small>
        {row.progress === undefined ? null : (
          <progress max={100} value={row.progress} aria-label="Progress">
            {row.progress}%
          </progress>
        )}
      </div>
    </li>
  );
}

/** The Work strip on the shared status rows. */
export function ConnectedTownWorkStrip({ now }: { now: number }) {
  return <TownWorkStrip rows={useWorldStatuses()} now={now} />;
}
