import type { WorldUsageAnalytics } from "../../../../shared/usageAnalytics";
import {
  usageHarnessName,
  usageLiveByHarness,
  usageRuns,
} from "../usage/usageModel";
import type { UsageReadState } from "../usage/usageStore";
import {
  townFuelGauges,
  townFuelNotes,
  townResetTime,
  type TownFuelWindow,
} from "./townLimits";
import { TOWN_OBSERVATORY_WINDOWS } from "./townObservatoryLot";

/**
 * Town's observatory (#1029): where the crew's subscription budget is
 * watched. Its sign shows each harness's 5-hour and weekly windows, used and
 * when each resets; its windows light for the agents at work on each
 * harness; it opens the Usage screens. It reads only `world.usage.analytics`
 * (the run read the Usage screens share) and Town's own agents, and keeps
 * their honesty rules: no reading is "no reading", a stale one says so, a
 * refusal shows as "limit" with its reset, never as a level.
 *
 * Pure: geometry and the read model, for the painter, the landscape, the
 * DOM layer and tests.
 */

export {
  TOWN_OBSERVATORY_ROWS,
  TOWN_OBSERVATORY_WIDTH,
  TOWN_OBSERVATORY_WINDOW,
  TOWN_OBSERVATORY_WINDOWS,
  townObservatoryLot,
  townObservatoryReserve,
  type TownObservatoryLot,
} from "./townObservatoryLot";

/** One window of one harness on the sign. */
export type TownObservatoryCell =
  | {
      kind: "used";
      label: string;
      used: number;
      low: boolean;
      resetsAt: number | null;
    }
  | { kind: "reached"; label: string; resetsAt: number | null }
  | { kind: "none"; label: string };

export type TownObservatoryDial = {
  harness: string;
  name: string;
  /** The 5 h window, then the week, each as read or "none". */
  cells: TownObservatoryCell[];
  stale: boolean;
  /** Agents at work on this harness now. */
  atWork: number;
  /** Why it keeps no readable limits, when it does not. */
  note: string | null;
};

export type TownObservatory =
  /** No read yet. */
  | { status: "loading" }
  /** The read failed or is too old to show. */
  | { status: "failed"; atWork: TownObservatoryLights }
  | {
      status: "ready";
      dials: TownObservatoryDial[];
      atWork: TownObservatoryLights;
    };

/** The windows' lights: one per agent at work, by harness. */
export type TownObservatoryLights = { harness: string; count: number }[];

/** The sign's columns: the windows the mandate names, in this order. */
const WINDOWS = [
  { minutes: 300, label: "5 h" },
  { minutes: 10080, label: "week" },
] as const;

/** Agents at work in Town by harness: what lights the windows. */
export function townObservatoryWorking(
  agents: Iterable<{ harness?: string; semanticStatus: string }>,
) {
  const working = new Map<string, number>();
  for (const agent of agents)
    if (agent.semanticStatus === "working" && agent.harness)
      working.set(agent.harness, (working.get(agent.harness) ?? 0) + 1);
  return working;
}

/**
 * Who is at work per harness: Town's working agents, or the read's live
 * runs where those are more (a run on a host Town is not showing).
 */
function lights(
  working: ReadonlyMap<string, number>,
  live: ReadonlyMap<string, number>,
): TownObservatoryLights {
  const harnesses = [...new Set([...working.keys(), ...live.keys()])].sort();
  return harnesses
    .map((harness) => ({
      harness,
      count: Math.max(working.get(harness) ?? 0, live.get(harness) ?? 0),
    }))
    .filter((light) => light.count > 0);
}

function cell(
  window: TownFuelWindow | undefined,
  label: string,
): TownObservatoryCell {
  if (!window) return { kind: "none", label };
  if (window.reached)
    return { kind: "reached", label, resetsAt: window.resetsAt };
  return {
    kind: "used",
    label,
    used: window.used,
    low: window.low,
    resetsAt: window.resetsAt,
  };
}

/** The observatory as the read and Town's agents have it now. */
export function townObservatory(
  state: UsageReadState,
  working: ReadonlyMap<string, number>,
  now: number,
): TownObservatory {
  if (state.status === "idle" || state.status === "loading")
    return { status: "loading" };
  if (state.status === "failed")
    return { status: "failed", atWork: lights(working, new Map()) };
  return townObservatoryFrom(state.data, working, now);
}

export function townObservatoryFrom(
  data: WorldUsageAnalytics,
  working: ReadonlyMap<string, number>,
  now: number,
): TownObservatory {
  const atWork = lights(working, usageLiveByHarness(usageRuns(data)));
  const gauges = townFuelGauges(data.limits, now);
  const notes = townFuelNotes(data.limits, gauges);
  const dials: TownObservatoryDial[] = gauges.map((gauge) => {
    const reached = gauge.windows.find((w) => w.reached);
    return {
      harness: gauge.harness,
      name: gauge.name,
      cells: WINDOWS.map(({ label }) =>
        cell(
          reached && (reached.label === label || reached.label === "limit")
            ? reached
            : gauge.windows.find((w) => w.label === label && !w.reached),
          label,
        ),
      ),
      stale: gauge.stale,
      atWork: atWork.find((l) => l.harness === gauge.harness)?.count ?? 0,
      note: null,
    };
  });
  // A harness at work with no reading, or one that keeps none, still shows.
  const named = new Set(dials.map((d) => d.harness));
  for (const note of notes)
    if (!named.has(note.harness)) {
      named.add(note.harness);
      dials.push(noReading(note.harness, atWork, note.reason));
    }
  for (const light of atWork)
    if (!named.has(light.harness))
      dials.push(noReading(light.harness, atWork, null));
  return { status: "ready", dials, atWork };
}

function noReading(
  harness: string,
  atWork: TownObservatoryLights,
  note: string | null,
): TownObservatoryDial {
  return {
    harness,
    name: usageHarnessName(harness),
    cells: WINDOWS.map(({ label }) => ({ kind: "none", label })),
    stale: false,
    atWork: atWork.find((l) => l.harness === harness)?.count ?? 0,
    note,
  };
}

/** "40% · 17:20", "limit · Tue 14:00", "no reading". */
export function townObservatoryCellText(cell: TownObservatoryCell) {
  const reset =
    "resetsAt" in cell && cell.resetsAt !== null
      ? townResetTime(cell.resetsAt)
      : null;
  switch (cell.kind) {
    case "used":
      return reset ? `${cell.used}% · ${reset}` : `${cell.used}%`;
    case "reached":
      return reset ? `limit · ${reset}` : "limit";
    case "none":
      return "no reading";
  }
}

/** A cell in words for names: "5 h 40% used, resets Tue 14:00". */
export function townObservatoryCellSpoken(cell: TownObservatoryCell) {
  const reset =
    "resetsAt" in cell && cell.resetsAt !== null
      ? `, resets ${townResetTime(cell.resetsAt)}`
      : "";
  switch (cell.kind) {
    case "used":
      return `${cell.label} ${cell.used}% used${reset}`;
    case "reached":
      return `${cell.label} limit reached${reset}`;
    case "none":
      return `${cell.label} no reading`;
  }
}

/** The whole sign in words, for the button's name. */
export function townObservatorySpoken(observatory: TownObservatory) {
  if (observatory.status === "loading") return "reading usage";
  if (observatory.status === "failed") return "usage unavailable";
  if (!observatory.dials.length) return "no budget reading yet";
  return observatory.dials
    .map((dial) => {
      const work = dial.atWork ? `, ${dial.atWork} at work` : "";
      const old = dial.stale ? ", out of date" : "";
      return `${dial.name}${work}: ${dial.cells
        .map(townObservatoryCellSpoken)
        .join(", ")}${old}`;
    })
    .join("; ");
}

/** The windows to light, in order: each harness's agents in a run. */
export function townObservatoryLit(atWork: TownObservatoryLights) {
  const lit: string[] = [];
  for (const light of atWork)
    for (let i = 0; i < light.count; i += 1) lit.push(light.harness);
  return {
    lit: lit.slice(0, TOWN_OBSERVATORY_WINDOWS.length),
    more: Math.max(0, lit.length - TOWN_OBSERVATORY_WINDOWS.length),
  };
}
