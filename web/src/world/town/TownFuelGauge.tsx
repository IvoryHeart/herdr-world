import { useId, useState } from "react";
import {
  townResetTime,
  townSeenAge,
  type TownFuelGauge,
  type TownFuelWindow,
} from "./townLimits";
import "./townFuel.css";

/** "5 h resets Tue 14:00 · week resets Sat 09:00 · seen 3 min ago · Codex session log" */
export function townFuelDetails(gauge: TownFuelGauge, now: number) {
  const resets = gauge.windows.map((w) =>
    w.resetsAt === null
      ? `${w.label} reset unknown`
      : `${gauge.windows.length > 1 ? `${w.label} ` : ""}resets ${townResetTime(w.resetsAt)}`,
  );
  return [
    ...(gauge.stale
      ? [
          `stale: last ${gauge.windows.map((w) => `${w.label} ${w.left} % left`).join(", ")}`,
        ]
      : []),
    ...resets,
    `seen ${townSeenAge(gauge.observedAt, now)}`,
    gauge.source,
  ].join(" · ");
}

const windowText = (gauge: TownFuelGauge, w: TownFuelWindow) =>
  gauge.stale
    ? `${w.label} stale`
    : `${w.label} ${w.left} % left${w.low ? ", low" : ""}`;

/**
 * One harness's fuel on the Town board sign: a short bar per limit window
 * with the percent left. Hover, focus or a tap shows when each resets and
 * how old the observation is. A stale gauge shows no level at all.
 */
export function TownFuelGaugeView({
  gauge,
  now,
}: {
  gauge: TownFuelGauge;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className="town-fuel-gauge" data-open={open}>
      <button
        type="button"
        data-stale={gauge.stale}
        aria-expanded={open}
        aria-describedby={detailsId}
        aria-label={`${gauge.name} limits: ${gauge.windows.map((w) => windowText(gauge, w)).join("; ")}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span className="town-fuel-name">{gauge.name}</span>
        {gauge.windows.map((w) => (
          <span
            key={w.label}
            className="town-fuel-window"
            data-low={!gauge.stale && w.low}
          >
            <span className="town-fuel-label">{w.label}</span>
            <span className="town-fuel-bar" aria-hidden="true">
              {gauge.stale ? null : <span style={{ width: `${w.left}%` }} />}
            </span>
            <span className="town-fuel-value">
              {gauge.stale ? "stale" : `${w.left}%`}
              {!gauge.stale && w.low ? " low" : ""}
            </span>
          </span>
        ))}
      </button>
      <span id={detailsId} role="tooltip" className="town-fuel-details">
        {townFuelDetails(gauge, now)}
      </span>
    </div>
  );
}

/** The board's fuel row: one gauge per harness that has limit numbers. */
export function TownFuel({
  gauges,
  now,
}: {
  gauges: readonly TownFuelGauge[];
  now: number;
}) {
  if (!gauges.length) return null;
  return (
    <div className="town-fuel" role="group" aria-label="Subscription limits">
      <span className="town-fuel-title">FUEL</span>
      {gauges.map((gauge) => (
        <TownFuelGaugeView key={gauge.harness} gauge={gauge} now={now} />
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
