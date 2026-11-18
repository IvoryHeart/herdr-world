import type { TownCensusItem } from "./townCensus";
import type { TownCensusControl } from "./useTownCensus";
import "./townCensus.css";

/**
 * Town's census (#980) on the Town board sign and in the Town summary: every
 * number is a button that lights what it counts on the map (useTownCensus).
 * Quiet identity, loud attention: only a waiting count above zero takes the
 * attention colour.
 */

/** The board's four agent columns, each lighting its agents. */
const COLUMNS = ["working", "waiting", "done", "quiet"];

export function TownCensusCounts({ control }: { control: TownCensusControl }) {
  const columns = COLUMNS.map((id) =>
    control.census.population.find((entry) => entry.id === id),
  ).filter((entry) => entry !== undefined);
  return (
    <div className="town-board-counts" role="group" aria-label="Agents">
      {columns.map((entry) => (
        <CensusButton
          key={entry.id}
          entry={entry}
          control={control}
          onShow={control.show}
          status={entry.id === "waiting" ? "blocked" : entry.id}
        >
          <span className="town-census-label">{entry.label}</span>
          <b>{entry.count}</b>
        </CensusButton>
      ))}
    </div>
  );
}

/**
 * The rest of the census on the board sign, under its columns: places and
 * population in one line, then skills, then what is lit.
 */
export function TownCensusBoard({ control }: { control: TownCensusControl }) {
  const { places, population, skills } = control.census;
  const more = population.filter((entry) => !COLUMNS.includes(entry.id));
  return (
    <div className="town-census" role="group" aria-label="Town census">
      <CensusLine
        items={[...places, ...more]}
        control={control}
        onShow={control.show}
      />
      {skills.length ? (
        <CensusLine
          title="Skills"
          items={skills}
          control={control}
          onShow={control.show}
        />
      ) : null}
      <TownCensusShowing control={control} variant="board" />
    </div>
  );
}

/**
 * The census in the Town summary window, one line per kind. `onShow` lets
 * a phone close the window first, since it covers Town.
 */
export function TownCensusSection({
  control,
  onShow,
}: {
  control: TownCensusControl;
  onShow(id: string): void;
}) {
  const { places, population, skills } = control.census;
  return (
    <section aria-labelledby="town-summary-census" className="town-census">
      <h3 id="town-summary-census">Census</h3>
      <CensusLine
        title="Places"
        items={places}
        control={control}
        onShow={onShow}
      />
      <CensusLine
        title="Population"
        items={population}
        control={control}
        onShow={onShow}
      />
      <CensusLine
        title="Skills"
        items={skills}
        control={control}
        onShow={onShow}
        empty="No agents yet."
      />
    </section>
  );
}

/**
 * What is lit, with **Next** to show its places one at a time and ✕ to end
 * it: inside the board sign, or under the phone chip (the board is hidden).
 */
export function TownCensusShowing({
  control,
  variant,
}: {
  control: TownCensusControl | undefined;
  variant: "board" | "chip";
}) {
  const lit = control?.lit;
  if (!control || !lit) return null;
  const text = `Showing ${lit.showing}${
    control.offscreen ? ` · ${control.offscreen} off-screen` : ""
  }`;
  return (
    <div
      className={
        variant === "chip" ? "town-census-chip" : "town-census-showing"
      }
      role="status"
    >
      <span>{text}</span>
      <button
        type="button"
        disabled={!lit.keys.length}
        title="Show the next one"
        onClick={control.next}
      >
        Next
      </button>
      <button
        type="button"
        aria-label="Stop showing"
        title="Stop showing (Escape)"
        onClick={control.clear}
      >
        ✕
      </button>
    </div>
  );
}

function CensusLine({
  title,
  items,
  control,
  onShow,
  empty,
}: {
  title?: string;
  items: readonly TownCensusItem[];
  control: TownCensusControl;
  onShow(id: string): void;
  empty?: string;
}) {
  if (!items.length && !empty) return null;
  return (
    <div className="town-census-line">
      {title ? <span className="town-census-title">{title}</span> : null}
      {items.length ? (
        items.map((entry) => (
          <CensusButton
            key={entry.id}
            entry={entry}
            control={control}
            onShow={onShow}
            status={entry.id === "waiting" ? "blocked" : undefined}
          >
            <b>{entry.count}</b> {entry.label}
          </CensusButton>
        ))
      ) : (
        <span className="town-census-empty">{empty}</span>
      )}
    </div>
  );
}

function CensusButton({
  entry,
  control,
  onShow,
  status,
  children,
}: {
  entry: TownCensusItem;
  control: TownCensusControl;
  onShow(id: string): void;
  status?: string;
  children: React.ReactNode;
}) {
  const pressed = control.lit?.id === entry.id;
  return (
    <button
      type="button"
      className="town-census-count"
      data-status={status}
      data-attention={entry.attention ? true : undefined}
      aria-pressed={pressed}
      disabled={!entry.keys.length && !pressed}
      aria-label={`${pressed ? "Stop showing" : "Show"} ${entry.showing} in Town`}
      title={pressed ? "Stop showing" : "Show in Town"}
      onClick={() => onShow(entry.id)}
    >
      {children}
    </button>
  );
}
