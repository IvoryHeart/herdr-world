/**
 * Town's post office (#1098): the place for what is addressed to you. Its
 * sign counts Needs you's items by kind, as Needs you lists them
 * (needsYou.ts), and the Outbox's answers to check; opening it opens Needs
 * you. It holds no pull requests: those are the warehouse's
 * (townWarehouseModel.ts). Pure counting and geometry; TownPostOffice.tsx
 * draws it.
 */

import type { AgentMarkKind } from "../agentMarks";
import type { NeedsYouItem } from "../needsYou";
import { TOWN_CENTER_FRIEZE_Y, type TownCenterLot } from "./townCenter";
import { TOWN_TILE } from "./townLayout";
import type { TownPostLot } from "./townPostLot";

/** What the post office counts: Needs you's kinds and the Outbox. */
export type TownPostCounts = {
  /** Questions agents asked you (`herdr-world ask`). */
  asks: number;
  /** Agents blocked on their own question. */
  needs: number;
  /** Finished work not reviewed yet. */
  done: number;
  /** Saved answers to check in Town Summary's Outbox. */
  outbox: number;
};

export const TOWN_POST_EMPTY: TownPostCounts = {
  asks: 0,
  needs: 0,
  done: 0,
  outbox: 0,
};

/** Needs you's items by kind, plus the Outbox's answers to check. */
export function townPostCounts(
  items: readonly Pick<NeedsYouItem, "kind">[],
  outbox: number,
): TownPostCounts {
  const counts = { ...TOWN_POST_EMPTY, outbox };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

/** What waits on you: questions and blocked agents, as the counter counts. */
export const townPostWaiting = (counts: TownPostCounts) =>
  counts.asks + counts.needs;

/** One count on the sign: its mark, number and words. */
export type TownPostPart = {
  key: keyof TownPostCounts;
  /** The shared agent mark; the Outbox is a letter, not an agent state. */
  mark: AgentMarkKind | null;
  count: number;
  /** Short, on the sign. */
  text: string;
  /** In full, for the accessible name. */
  spoken: string;
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The sign's counts, most urgent first, leaving out kinds with none: "? 2
 * questions", "! 1 blocked", "✓ 3 to review", "✉ 1 to check".
 */
export function townPostParts(counts: TownPostCounts): TownPostPart[] {
  const parts: TownPostPart[] = [
    {
      key: "asks",
      mark: "asks",
      count: counts.asks,
      text: plural(counts.asks, "question", "questions"),
      spoken: plural(counts.asks, "question for you", "questions for you"),
    },
    {
      key: "needs",
      mark: "needs",
      count: counts.needs,
      text: `${counts.needs} blocked`,
      spoken: plural(counts.needs, "agent blocked", "agents blocked"),
    },
    {
      key: "done",
      mark: "done",
      count: counts.done,
      text: `${counts.done} to review`,
      spoken: plural(counts.done, "finished to review", "finished to review"),
    },
    {
      key: "outbox",
      mark: null,
      count: counts.outbox,
      text: `${counts.outbox} to check`,
      spoken: plural(counts.outbox, "answer to check", "answers to check"),
    },
  ];
  return parts.filter((part) => part.count > 0);
}

/** The sign in words: its counts, or that nothing is addressed to you. */
export function townPostSpoken(counts: TownPostCounts) {
  const parts = townPostParts(counts);
  return parts.length
    ? parts.map((part) => part.spoken).join(", ")
    : "nothing for you";
}

/**
 * Where a wide town's sign stands, in world pixels: on the ridge at the
 * roof's right end, growing up and left over the lawn, so at every zoom it
 * leaves the house's front and the town center's west wing in view.
 */
export function townPostSignAt(lot: TownPostLot) {
  return { x: (lot.x + lot.w) * TOWN_TILE - 10, y: lot.y * TOWN_TILE + 6 };
}

/**
 * Where a narrow town's folded post office hangs, in world pixels: on the
 * town center's right wing, under its windows and level with the doors,
 * inside a phone's home view (the roofs above it are cropped there). The
 * harbour's signs share the left wing (townHarbourLot.ts).
 */
export function townPostFoldAt(center: TownCenterLot) {
  return {
    x: (center.x + center.w) * TOWN_TILE - 60,
    y: center.y * TOWN_TILE + TOWN_CENTER_FRIEZE_Y + 40,
  };
}
