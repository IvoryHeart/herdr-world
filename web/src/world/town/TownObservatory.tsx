import { memo, useMemo } from "react";
import type { OfficeAgent } from "../officeProjectionTypes";
import { useUsageAnalytics } from "../usage/usageStore";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_OBSERVATORY_WINDOW,
  TOWN_OBSERVATORY_WINDOWS,
  townObservatory,
  townObservatoryCellSpoken,
  townObservatoryCellText,
  townObservatoryLit,
  townObservatoryLot,
  townObservatorySpoken,
  townObservatoryWorking,
  type TownObservatory as Observatory,
  type TownObservatoryCell,
} from "./townObservatoryModel";
import { useOpenTownUsage } from "./TownUsageLens";
import { useTownPlace } from "./useTownPlace";
import "./townObservatory.css";

/**
 * The observatory's DOM layer (#1029): its sign with each harness's 5 h and
 * week used and when each resets, and a lit window per agent at work, on
 * a narrow (phone) town too (#1351). The sign opens the Usage screens.
 */
export const TownObservatory = memo(function TownObservatory({
  layout,
  agents,
}: {
  layout: TownLayout;
  agents: ReadonlyMap<string, OfficeAgent>;
}) {
  const state = useUsageAnalytics("run", "7d");
  const working = useMemo(
    () => townObservatoryWorking(agents.values()),
    [agents],
  );
  const observatory = townObservatory(state, working, Date.now());
  const open = useOpenTownUsage();
  const lot = townObservatoryLot(layout);
  const name = `Observatory: ${townObservatorySpoken(observatory)}${open ? ". Open Usage" : ""}`;
  const press = (event: React.MouseEvent) => {
    event.stopPropagation();
    open?.("budget");
  };
  // The building opens what the sign does (#1170); the town center's Buildings ring opens it too (#1261).
  const openBudget = useMemo(
    () => (open ? () => open("budget") : null),
    [open],
  );
  useTownPlace("observatory", openBudget);
  const atWork = observatory.status === "loading" ? [] : observatory.atWork;
  const { lit, more } = townObservatoryLit(atWork);
  return (
    <>
      <button
        type="button"
        className="town-observatory-sign"
        data-town-place="observatory"
        data-quiet={observatory.status !== "ready" || undefined}
        style={{ left: (lot.x + lot.w / 2) * T, top: lot.y * T + 2 }}
        aria-label={name}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={press}
      >
        <span className="town-observatory-title" aria-hidden="true">
          OBSERVATORY
        </span>
        <SignBody observatory={observatory} />
      </button>
      <div className="town-observatory-lights" aria-hidden="true">
        {lit.map((harness, index) => {
          const at = TOWN_OBSERVATORY_WINDOWS[index]!;
          return (
            <span
              key={index}
              className="town-observatory-light"
              data-harness={harness}
              style={{
                left: lot.x * T + at.x,
                top: lot.y * T + at.y,
                width: TOWN_OBSERVATORY_WINDOW.w,
                height: TOWN_OBSERVATORY_WINDOW.h,
              }}
            />
          );
        })}
        {more ? (
          <span
            className="town-observatory-more"
            style={{ left: (lot.x + lot.w) * T - 8, top: lot.y * T + 70 }}
          >
            +{more}
          </span>
        ) : null}
      </div>
    </>
  );
});

const WAITING = { loading: "Reading usage…", failed: "Usage unavailable" };

function SignBody({ observatory }: { observatory: Observatory }) {
  if (observatory.status !== "ready")
    return (
      <span className="town-observatory-note" aria-hidden="true">
        {WAITING[observatory.status]}
      </span>
    );
  if (!observatory.dials.length)
    return (
      <span className="town-observatory-note" aria-hidden="true">
        No budget reading yet
      </span>
    );
  return (
    <span className="town-observatory-dials" aria-hidden="true">
      <span className="town-observatory-head" />
      <span className="town-observatory-head">5 h</span>
      <span className="town-observatory-head">week</span>
      {observatory.dials.map((dial) => (
        <span
          key={dial.harness}
          className="town-observatory-row"
          data-stale={dial.stale || undefined}
        >
          <span className="town-observatory-name">
            {dial.name}
            {dial.atWork ? (
              <b data-harness={dial.harness}>{dial.atWork}</b>
            ) : null}
          </span>
          {dial.cells.map((cell) => (
            <Cell key={cell.label} cell={cell} />
          ))}
          {dial.stale ? (
            <span className="town-observatory-stale">out of date</span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

function Cell({ cell }: { cell: TownObservatoryCell }) {
  return (
    <span
      className="town-observatory-cell"
      data-kind={cell.kind}
      data-low={(cell.kind === "used" && cell.low) || undefined}
      title={townObservatoryCellSpoken(cell)}
    >
      {cell.kind === "used" ? (
        <i style={{ "--used": `${cell.used}%` } as React.CSSProperties} />
      ) : null}
      {townObservatoryCellText(cell)}
    </span>
  );
}
