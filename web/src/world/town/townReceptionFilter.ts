/**
 * Which agents each Town reception takes (#501). Reception takes agents by
 * their mark: blocked `!`, asking the owner `?` and finished `✓`. An agent
 * whose mark its building's reception does not take stays seated at its own
 * desk with the mark overhead: the filter moves bodies, never facts. Marks,
 * Town board counts, room plaques, Board cards, Desk lanes and Needs you stay
 * keyed by state and never read this filter.
 *
 * The filter is a World default plus an optional override per building
 * (keyed by the building's connection ID). The World service stores it as an
 * interface preference (`bridge.ui_settings`, key `townReception`), so every
 * browser and device sees the same one; the browser owns its schema.
 */

import type { AgentMarkKind } from "../agentMarks";

export type TownReceptionMark = "blocked" | "ask" | "done";

/** In reception's order: urgent blocking, owner questions, finishes. */
export const TOWN_RECEPTION_MARKS: readonly TownReceptionMark[] = [
  "blocked",
  "ask",
  "done",
];

/** Each mark as World draws it everywhere (agentMarks.ts). */
export const TOWN_RECEPTION_AGENT_MARK: Record<
  TownReceptionMark,
  AgentMarkKind
> = {
  blocked: "needs",
  ask: "asks",
  done: "done",
};

export type TownReceptionFilter = {
  /** The marks every reception without its own setting takes. */
  default: readonly TownReceptionMark[];
  /** A building's own marks, by its connection ID. */
  hosts: Readonly<Record<string, readonly TownReceptionMark[]>>;
};

/** The setting's key in the World service's interface preferences. */
export const TOWN_RECEPTION_SETTING_KEY = "townReception";

/** Reception as it always was: it takes every mark. */
export const TOWN_RECEPTION_DEFAULT: TownReceptionFilter = {
  default: TOWN_RECEPTION_MARKS,
  hosts: {},
};

const MAX_OVERRIDES = 64;
const ID = /^[A-Za-z0-9:_.@-]{1,128}$/;

function parseMarks(value: unknown): TownReceptionMark[] | null {
  if (!Array.isArray(value)) return null;
  return TOWN_RECEPTION_MARKS.filter((mark) => value.includes(mark));
}

/** A stored value as a filter; anything unreadable is the default. */
export function parseTownReceptionFilter(value: unknown): TownReceptionFilter {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return TOWN_RECEPTION_DEFAULT;
  const hosts: Record<string, TownReceptionMark[]> = {};
  if (v.hosts && typeof v.hosts === "object")
    for (const [id, marks] of Object.entries(v.hosts).slice(0, MAX_OVERRIDES)) {
      const parsed = parseMarks(marks);
      if (ID.test(id) && parsed) hosts[id] = parsed;
    }
  return {
    default: parseMarks(v.default) ?? TOWN_RECEPTION_MARKS,
    hosts,
  };
}

/** The marks one building's reception takes. */
export function townReceptionTakes(
  filter: TownReceptionFilter,
  connectionId: string | undefined,
): ReadonlySet<TownReceptionMark> {
  const own =
    connectionId !== undefined &&
    Object.prototype.hasOwnProperty.call(filter.hosts, connectionId)
      ? filter.hosts[connectionId]
      : undefined;
  return new Set(own ?? filter.default);
}

/** Whether a building has its own setting rather than the World default. */
export function townReceptionOverridden(
  filter: TownReceptionFilter,
  connectionId: string,
) {
  return Object.prototype.hasOwnProperty.call(filter.hosts, connectionId);
}

/**
 * The mark that sends an agent to reception, as its bubble shows it: blocked
 * over a question over a finish; null when nothing sends it there.
 */
export function townReceptionMark(
  status: string,
  asking: boolean,
): TownReceptionMark | null {
  if (status === "blocked") return "blocked";
  if (asking) return "ask";
  if (status === "done") return "done";
  return null;
}

/** The marks each building's reception takes, by host key. */
export type TownReceptionTakes = (
  hostKey: string,
) => ReadonlySet<TownReceptionMark>;

const ALL: ReadonlySet<TownReceptionMark> = new Set(TOWN_RECEPTION_MARKS);
/** Every reception takes every mark (the default). */
export const townReceptionTakesAll: TownReceptionTakes = () => ALL;

type Placed = { key: string; hostKey: string; semanticStatus: string };

/**
 * The agents that would wait at reception but whose building's reception
 * does not take their mark: they stay seated at their desks.
 */
export function townReceptionHeld(
  agents: Iterable<Placed>,
  asking: ReadonlySet<string>,
  takes: TownReceptionTakes,
): ReadonlySet<string> {
  const held = new Set<string>();
  for (const agent of agents) {
    const mark = townReceptionMark(agent.semanticStatus, asking.has(agent.key));
    if (mark && !takes(agent.hostKey).has(mark)) held.add(agent.key);
  }
  return held;
}

const ordered = (marks: Iterable<TownReceptionMark>) => {
  const set = new Set(marks);
  return TOWN_RECEPTION_MARKS.filter((mark) => set.has(mark));
};

/**
 * Set the marks a reception takes: the building's own setting when it has
 * one, else the World default.
 */
export function withTownReceptionMarks(
  filter: TownReceptionFilter,
  connectionId: string,
  marks: Iterable<TownReceptionMark>,
): TownReceptionFilter {
  return townReceptionOverridden(filter, connectionId)
    ? { ...filter, hosts: { ...filter.hosts, [connectionId]: ordered(marks) } }
    : { ...filter, default: ordered(marks) };
}

/**
 * Give a building its own setting (starting from what it takes now), or
 * return it to the World default.
 */
export function withTownReceptionOwn(
  filter: TownReceptionFilter,
  connectionId: string,
  own: boolean,
): TownReceptionFilter {
  if (own === townReceptionOverridden(filter, connectionId)) return filter;
  const hosts = { ...filter.hosts };
  if (own) {
    if (Object.keys(hosts).length >= MAX_OVERRIDES) return filter;
    hosts[connectionId] = [...filter.default];
  } else delete hosts[connectionId];
  return { ...filter, hosts };
}

/**
 * Reset to default: the building drops its own setting and the World default
 * takes every mark again, so this reception takes everyone it always did.
 */
export function withTownReceptionReset(
  filter: TownReceptionFilter,
  connectionId: string,
): TownReceptionFilter {
  const hosts = { ...filter.hosts };
  delete hosts[connectionId];
  return { default: TOWN_RECEPTION_MARKS, hosts };
}

/** Whether a filter takes every mark everywhere (stores as nothing). */
export function townReceptionIsDefault(filter: TownReceptionFilter) {
  return (
    filter.default.length === TOWN_RECEPTION_MARKS.length &&
    Object.keys(filter.hosts).length === 0
  );
}
