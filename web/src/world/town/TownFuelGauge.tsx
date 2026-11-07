import { Fuel } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import {
  townFuelAge,
  townReachedText,
  townResetTime,
  townSeenAge,
  type TownFuelGauge,
  type TownFuelNote,
  type TownFuelWindow,
} from "./townLimits";
import "./townFuel.css";

/** A window's level in words: "5 h 60 % left", or "5 h limit reached". */
const levelText = (w: TownFuelWindow) =>
  w.reached ? townReachedText(w) : `${w.label} ${w.left} % left`;

/** "5 h resets Tue 14:00 · week resets Sat 09:00 · seen 3 min ago · Codex session log" */
export function townFuelDetails(gauge: TownFuelGauge, now: number) {
  const resets = gauge.windows.map((w) =>
    w.resetsAt === null
      ? `${w.label} reset unknown`
      : w.reached && !gauge.stale
        ? `${townReachedText(w)}, resets ${townResetTime(w.resetsAt)}`
        : `${gauge.windows.length > 1 ? `${w.label} ` : ""}resets ${townResetTime(w.resetsAt)}`,
  );
  return [
    ...(gauge.stale
      ? [`stale: last ${gauge.windows.map(levelText).join(", ")}`]
      : []),
    ...resets,
    `seen ${townSeenAge(gauge.observedAt, now)}`,
    gauge.source,
  ].join(" · ");
}

const windowText = (gauge: TownFuelGauge, w: TownFuelWindow) =>
  gauge.stale
    ? `${w.label} stale`
    : w.reached
      ? `${townReachedText(w)}${w.resetsAt === null ? "" : `, resets ${townResetTime(w.resetsAt)}`}`
      : `${w.label} ${w.left} % left${w.low ? ", low" : ""}`;

/**
 * One entry on the fuel row: a button whose hover, focus or tap shows its
 * details below it, and Escape closes.
 */
function TownFuelTip({
  label,
  stale,
  unavailable,
  details,
  children,
}: {
  label: string;
  stale?: boolean;
  unavailable?: boolean;
  details: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className="town-fuel-gauge" data-open={open}>
      <button
        type="button"
        data-stale={stale ? true : undefined}
        data-unavailable={unavailable ? true : undefined}
        aria-expanded={open}
        aria-describedby={detailsId}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {children}
      </button>
      <span id={detailsId} role="tooltip" className="town-fuel-details">
        {details}
      </span>
    </div>
  );
}

/**
 * One harness's fuel on the Town board sign: a short bar per limit window
 * with the percent left, and "seen <age> ago" under them once the reading is
 * more than 15 minutes old. Hover, focus or a tap shows when each resets and
 * how old the observation is. A stale gauge shows no level at all.
 */
export function TownFuelGaugeView({
  gauge,
  now,
}: {
  gauge: TownFuelGauge;
  now: number;
}) {
  const age = townFuelAge(gauge, now);
  return (
    <TownFuelTip
      label={`${gauge.name} limits: ${gauge.windows.map((w) => windowText(gauge, w)).join("; ")}${age ? `; ${age}` : ""}`}
      stale={gauge.stale}
      details={townFuelDetails(gauge, now)}
    >
      <span className="town-fuel-name">{gauge.name}</span>
      {gauge.windows.map((w) => (
        <span
          key={w.label}
          className="town-fuel-window"
          data-low={!gauge.stale && w.low}
        >
          <span className="town-fuel-label">{w.label}</span>
          {!gauge.stale && w.reached ? (
            <span className="town-fuel-reached">
              reached
              {w.resetsAt === null
                ? ""
                : `, resets ${townResetTime(w.resetsAt)}`}
            </span>
          ) : (
            <>
              <span className="town-fuel-bar" aria-hidden="true">
                {gauge.stale ? null : <span style={{ width: `${w.left}%` }} />}
              </span>
              <span className="town-fuel-value">
                {gauge.stale ? "stale" : `${w.left}%`}
                {!gauge.stale && w.low ? " low" : ""}
              </span>
            </>
          )}
        </span>
      ))}
      {age ? <span className="town-fuel-age">{age}</span> : null}
    </TownFuelTip>
  );
}

/** A harness with no readable limits: named, "not available", and why. */
export function TownFuelNoteView({ note }: { note: TownFuelNote }) {
  return (
    <TownFuelTip
      label={`${note.name} limits not available: ${note.reason}`}
      unavailable
      details={`Limits not available: ${note.reason}`}
    >
      <span className="town-fuel-name">{note.name}</span>
      <span className="town-fuel-window">
        <span className="town-fuel-unavailable">not available</span>
      </span>
    </TownFuelTip>
  );
}

/**
 * The board's fuel row: one gauge per harness that has limit numbers, and
 * a "not available" entry per harness that keeps none.
 */
export function TownFuel({
  gauges,
  notes = [],
  now,
}: {
  gauges: readonly TownFuelGauge[];
  notes?: readonly TownFuelNote[];
  now: number;
}) {
  if (!gauges.length && !notes.length) return null;
  return (
    <div className="town-fuel" role="group" aria-label="Subscription limits">
      <span className="town-fuel-title">FUEL</span>
      {gauges.map((gauge) => (
        <TownFuelGaugeView key={gauge.harness} gauge={gauge} now={now} />
      ))}
      {notes.map((note) => (
        <TownFuelNoteView key={note.harness} note={note} />
      ))}
    </div>
  );
}

/** The lowest current window across gauges, for the phone chip. */
export function townFuelLowest(gauges: readonly TownFuelGauge[]) {
  let lowest: { gauge: TownFuelGauge; window: TownFuelWindow } | null = null;
  for (const gauge of gauges)
    if (!gauge.stale && (!lowest || gauge.lowest.left < lowest.window.left))
      lowest = { gauge, window: gauge.lowest };
  return lowest;
}

type TownFuelLowest = NonNullable<ReturnType<typeof townFuelLowest>>;

/** The lowest fuel in words for the phone chip's label: "Codex week 8 % left, low; seen 1 h ago". */
export function townFuelLowestText(
  { gauge, window: w }: TownFuelLowest,
  now: number,
) {
  const age = townFuelAge(gauge, now);
  return `${gauge.name} ${
    w.reached
      ? townReachedText(w)
      : `${w.label} ${w.left} % left${w.low ? ", low" : ""}`
  }${age ? `; ${age}` : ""}`;
}

/** The phone chip's lowest fuel: percent left or "reached", and its age once over 15 minutes. */
export function TownFuelChip({
  lowest,
  now,
}: {
  lowest: TownFuelLowest;
  now: number;
}) {
  const age = townFuelAge(lowest.gauge, now);
  return (
    <span data-status="fuel" data-low={lowest.window.low}>
      <Fuel size={12} aria-hidden="true" />
      {lowest.window.reached ? "reached" : `${lowest.window.left}%`}
      {age ? <span className="town-fuel-age">{age}</span> : null}
    </span>
  );
}
