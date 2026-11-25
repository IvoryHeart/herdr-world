/**
 * Town's post office (#1098, #1105): the place for what is addressed to
 * you, mail and never cargo. Pull requests are the warehouse's crates
 * (townWarehouseModel.ts) and releases the harbour's ships (#1028).
 *
 * - Its sign (#1098) counts Needs you's items by kind, as Needs you lists
 *   them (needsYou.ts), and the Outbox's answers to check; opening it opens
 *   Needs you.
 * - Its yard (#1105) holds letters in: the questions agents asked you with
 *   `herdr-world ask` that are still open (the World ledger's asks, the
 *   same list Needs you answers), oldest first. Its mail trolley carries
 *   letters out: your saved answers the service is still delivering, or
 *   whose delivery needs a look (Town's Outbox).
 *
 * Pure counting, words and geometry; TownPostOffice.tsx draws it.
 */

import type { AgentMarkKind } from "../agentMarks";
import type { NeedsYouItem } from "../needsYou";
import { askerName, type WorldAsk } from "../worldAsks";
import { TOWN_TILE, type TownFormFactor } from "./townLayout";
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
 * Where the sign stands, in world pixels. A wide town's stands on the ridge
 * at the roof's right end, growing up and left over the lawn, so at every
 * zoom it leaves the house's front and the town center's west wing in view.
 * A narrow (phone) town's stands at the ridge's middle, growing straight up
 * with its counts stacked (townPost.css), so it stays over its own house and
 * inside a phone's view (#1351).
 */
export function townPostSignAt(
  lot: TownPostLot,
  formFactor: TownFormFactor = "wide",
) {
  return formFactor === "narrow"
    ? { x: (lot.x + lot.w / 2) * TOWN_TILE, y: lot.y * TOWN_TILE + 6 }
    : { x: (lot.x + lot.w) * TOWN_TILE - 10, y: lot.y * TOWN_TILE + 6 };
}

export type TownLetter = {
  /** The ask's id. */
  id: string;
  /** Who asked: Herdr's agent name, else how the service named the caller. */
  from: string;
  /** False when the service could not tell which agent asked. */
  verified: boolean;
  question: string;
  options: readonly string[];
  at: number;
};

/** Your saved answers on their way: still sending, or needing a look. */
export type TownOutgoing = { waiting: number; checks: number };

export type TownPostOffice = {
  letters: TownLetter[];
  outgoing: TownOutgoing;
};

export function townPostOffice(
  asks: readonly WorldAsk[],
  outgoing: TownOutgoing,
): TownPostOffice {
  return {
    letters: [...asks]
      .sort((left, right) => left.at - right.at)
      .map((ask) => ({
        id: ask.id,
        from: askerName(ask),
        verified: ask.actor.verified,
        question: ask.question,
        options: ask.options,
        at: ask.at,
      })),
    outgoing: {
      waiting: Math.max(0, outgoing.waiting),
      checks: Math.max(0, outgoing.checks),
    },
  };
}

/** A letter's name: who it is from, marked when unverified. */
export const townLetterFrom = (letter: TownLetter) =>
  `${letter.from}${letter.verified ? "" : " (unverified)"}`;

/** The question on one line, shortened for a label. */
export function townLetterLine(letter: TownLetter, max = 80) {
  const line = letter.question.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A letter's accessible name. */
export const townLetterLabel = (letter: TownLetter) =>
  `Letter from ${townLetterFrom(letter)}: ${townLetterLine(letter)}`;

/** Letters across the yard; its right end keeps the mail trolley. */
export const TOWN_POST_COLUMNS = 7;
export const TOWN_POST_ROWS = 3;
/** Letters the yard holds; more show as a "+N" bundle. */
export const TOWN_POST_SLOTS = TOWN_POST_COLUMNS * TOWN_POST_ROWS;
/** A letter's slot pitch and the yard's inset, in pixels. */
export const TOWN_POST_PITCH = { x: 20, y: 18 } as const;
export const TOWN_POST_INSET = { x: 6, y: 6 } as const;
/** The painted letter (townPostPaint.ts), in pixels. */
export const TOWN_LETTER_SIZE = { w: 14, h: 10 } as const;
/**
 * The mail trolley's bed (townPostPaint.ts): its left edge `fromRight`
 * pixels left of the yard's right edge, its top `y` pixels down, `w` wide.
 */
export const TOWN_POST_TROLLEY = { fromRight: 32, y: 22, w: 24 } as const;

/** How many letters lie in the yard; the rest make the "+N" bundle. */
export const townPostYardCount = (count: number) =>
  count > TOWN_POST_SLOTS ? TOWN_POST_SLOTS - 1 : count;

/** Slot `index`'s top-left in the yard, in pixels. */
export function townPostSlot(index: number) {
  return {
    x: TOWN_POST_INSET.x + (index % TOWN_POST_COLUMNS) * TOWN_POST_PITCH.x,
    y:
      TOWN_POST_INSET.y +
      Math.floor(index / TOWN_POST_COLUMNS) * TOWN_POST_PITCH.y,
  };
}
/** How long ago a letter was written: "just now", "12 min ago", "3 h ago". */
export function townLetterAge(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
