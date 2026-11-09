/**
 * Town's group selection (#820): several agents chosen at once, by a Shift
 * box or Shift+click on desktop and by Select then taps on a phone, given one
 * order from the Town board sign. This module is the model: which state each
 * chosen agent is in, the counts the sign shows, which agents each order acts
 * on and why the others are left out. Orders reuse the single-agent verbs
 * (Mark reviewed, Chat's send); nothing here talks to a host.
 */

import type { OfficeAgent } from "../officeProjectionTypes";

/** An agent's state as the sign counts it; the board's words. */
export type TownGroupState =
  | "finished"
  | "working"
  | "needsYou"
  | "idle"
  | "outOfFuel"
  | "unknown";

type GroupAgent = Pick<
  OfficeAgent,
  "key" | "semanticStatus" | "usageStop" | "stale" | "canOpenInSpaces"
>;

/**
 * Finished is work waiting for review (Town's finished calls); an agent
 * waiting on the owner needs you; an idle agent stopped on its usage limit is
 * out of fuel; reviewed finished work is idle again.
 */
export function townGroupState(
  agent: GroupAgent,
  finished: boolean,
): TownGroupState {
  if (finished) return "finished";
  if (agent.semanticStatus === "blocked") return "needsYou";
  if (agent.semanticStatus === "working") return "working";
  if (agent.usageStop) return "outOfFuel";
  if (agent.semanticStatus === "unknown") return "unknown";
  return "idle";
}

const ORDER: readonly [TownGroupState, string][] = [
  ["finished", "finished"],
  ["working", "working"],
  ["needsYou", "needs you"],
  ["idle", "idle"],
  ["outOfFuel", "out of fuel"],
  ["unknown", "unknown"],
];

export type TownGroupCounts = Record<TownGroupState, number> & {
  selected: number;
};

export function townGroupCounts(
  states: Iterable<TownGroupState>,
): TownGroupCounts {
  const counts: TownGroupCounts = {
    selected: 0,
    finished: 0,
    working: 0,
    needsYou: 0,
    idle: 0,
    outOfFuel: 0,
    unknown: 0,
  };
  for (const state of states) {
    counts.selected += 1;
    counts[state] += 1;
  }
  return counts;
}

/** "7 selected · 3 finished · 2 working · 1 needs you · 1 idle". */
export function townGroupCountsText(counts: TownGroupCounts) {
  return [
    `${counts.selected} selected`,
    ...ORDER.flatMap(([state, word]) =>
      counts[state] ? [`${counts[state]} ${word}`] : [],
    ),
  ].join(" · ");
}

/* ---------- the selection itself ---------- */

const NONE: ReadonlySet<string> = new Set();

/**
 * Toggle `keys` together: when every one is already chosen they all leave,
 * otherwise they all join (a table's agents, or one agent).
 */
export function townGroupToggle(
  current: ReadonlySet<string>,
  keys: readonly string[],
): ReadonlySet<string> {
  if (!keys.length) return current;
  const next = new Set(current);
  if (keys.every((key) => current.has(key)))
    for (const key of keys) next.delete(key);
  else for (const key of keys) next.add(key);
  return next.size ? next : NONE;
}

/** Add `keys` (a Shift box adds to what is chosen). */
export function townGroupAdd(
  current: ReadonlySet<string>,
  keys: Iterable<string>,
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const key of keys)
    if (!current.has(key)) (next ??= new Set(current)).add(key);
  return next ?? current;
}

/**
 * The selection without agents that left the map: closed (no longer an
 * agent Town shows) or put in the bin. The same set while none left.
 */
export function townGroupPrune(
  current: ReadonlySet<string>,
  onMap: (key: string) => boolean,
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const key of current)
    if (!onMap(key)) (next ??= new Set(current)).delete(key);
  if (!next) return current;
  return next.size ? next : NONE;
}

/**
 * An agent's drawn body around its position (its feet): what a box must
 * touch to take it, in world pixels.
 */
export const TOWN_AGENT_BODY = { halfWidth: 10, above: 44, below: 4 };

/**
 * The agents a world box touches, wherever they stand: a box over any part
 * of an agent's body takes it.
 */
export function townBoxKeys(
  box: { x0: number; y0: number; x1: number; y1: number },
  keys: Iterable<string>,
  position: (key: string) => { x: number; y: number } | null,
): string[] {
  const left = Math.min(box.x0, box.x1);
  const right = Math.max(box.x0, box.x1);
  const top = Math.min(box.y0, box.y1);
  const bottom = Math.max(box.y0, box.y1);
  const inside: string[] = [];
  for (const key of keys) {
    const at = position(key);
    if (
      at &&
      at.x + TOWN_AGENT_BODY.halfWidth >= left &&
      at.x - TOWN_AGENT_BODY.halfWidth <= right &&
      at.y + TOWN_AGENT_BODY.below >= top &&
      at.y - TOWN_AGENT_BODY.above <= bottom
    )
      inside.push(key);
  }
  return inside;
}

/** A world rectangle around points, padded; null without points. */
export function townGroupFrame(
  points: readonly { x: number; y: number }[],
  pad = 48,
) {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    x,
    y,
    width: Math.max(...xs) + pad - x,
    height: Math.max(...ys) + pad - y,
  };
}

/* ---------- which agents each order acts on ---------- */

/** Why an agent is left out of a group message, in the card's words. */
export type TownLeftOut =
  | "has a question"
  | "plain shell"
  | "out of fuel"
  | "offline";

/**
 * Whether one chosen agent can take a typed message. An agent waiting on a
 * question or permission prompt is left out: typed text could answer its
 * prompt (known issue #284), so it needs its own answer. A pane without a
 * harness (a plain shell) has no Chat; an agent stopped on its usage limit
 * cannot act on it; an offline one cannot be reached.
 */
export function townMessageLeftOut(
  agent: GroupAgent,
  leaf: {
    kind: string;
    stale?: boolean;
    capabilities?: { agentHistory?: boolean };
  } | null,
): TownLeftOut | null {
  if (agent.semanticStatus === "blocked") return "has a question";
  if (!leaf || leaf.kind !== "agent") return "plain shell";
  if (agent.usageStop) return "out of fuel";
  if (
    agent.stale ||
    leaf.stale ||
    !agent.canOpenInSpaces ||
    !leaf.capabilities?.agentHistory
  )
    return "offline";
  return null;
}

/** One chosen agent as the card lists it. */
export type TownGroupMember = {
  key: string;
  label: string;
  state: TownGroupState;
  /** Why a message leaves it out; null when it can take one. */
  leftOut: TownLeftOut | null;
};

/** The agents each order acts on, so its label shows exactly that number. */
export function townGroupOrders(members: readonly TownGroupMember[]) {
  return {
    review: members.filter((member) => member.state === "finished"),
    message: members.filter((member) => member.leftOut === null),
    leftOut: members.filter((member) => member.leftOut !== null),
  };
}

/** "Send a message (5 of 7)", or "(7)" when every chosen agent takes it. */
export function townOrderCount(acting: number, selected: number) {
  return acting === selected ? `(${acting})` : `(${acting} of ${selected})`;
}

/* ---------- what each send did ---------- */

/** One agent's send, as it arrives; never "sent" unless the host said so. */
export type TownSendOutcome =
  | { status: "sending" }
  | { status: "sent" }
  | { status: "queued" }
  | { status: "refused"; reason: string };

export function townSendOutcomeText(outcome: TownSendOutcome) {
  switch (outcome.status) {
    case "sending":
      return "sending…";
    case "sent":
      return "sent";
    case "queued":
      return "queued: it is busy and reads it next";
    case "refused":
      return `refused: ${outcome.reason}`;
  }
}

/** One agent's Mark reviewed, as it arrives. */
export type TownReviewOutcome = "marking" | "reviewed" | "not saved";

/** How many chosen agents each room holds, for the zoomed-out room cards. */
export function townGroupRooms(
  keys: ReadonlySet<string> | undefined,
  agents: ReadonlyMap<string, { roomKey: string }>,
): ReadonlyMap<string, number> {
  const rooms = new Map<string, number>();
  for (const key of keys ?? []) {
    const roomKey = agents.get(key)?.roomKey;
    if (roomKey) rooms.set(roomKey, (rooms.get(roomKey) ?? 0) + 1);
  }
  return rooms;
}
