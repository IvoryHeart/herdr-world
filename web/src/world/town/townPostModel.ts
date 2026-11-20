import { askerName, type WorldAsk } from "../worldAsks";
import { TOWN_TILE } from "./townLayout";
import type { TownPostLot } from "./townPostLot";

/**
 * Town's post office (#1105): mail, never cargo. Pull requests are the
 * warehouse's crates and releases the harbour's ships (#1028); the post
 * office carries messages between you and your agents:
 *
 * - Letters in: the questions agents asked you with `herdr-world ask` that
 *   are still open (the World ledger's asks, the same list Needs you
 *   answers), oldest first, each a letter in the sorting yard.
 * - Letters out: your saved answers the service is still delivering, or
 *   whose delivery needs a look (Town's Outbox), on the mail trolley.
 *
 * Pure: the read model, its words and the yard's geometry, for the DOM
 * layer (TownPostOffice.tsx) and tests.
 */

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

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** The sign's counts, each with its kind, in the order the sign shows them. */
export function townPostCountParts(office: TownPostOffice) {
  const parts: { kind: "letters" | "waiting" | "checks"; text: string }[] = [];
  if (office.letters.length)
    parts.push({
      kind: "letters",
      text: plural(office.letters.length, "letter", "letters"),
    });
  if (office.outgoing.waiting)
    parts.push({ kind: "waiting", text: `${office.outgoing.waiting} to send` });
  if (office.outgoing.checks)
    parts.push({ kind: "checks", text: `${office.outgoing.checks} to check` });
  return parts;
}

/** The sign's second line: "2 letters · 1 to send", or "No mail". */
export function townPostSignText(office: TownPostOffice) {
  const parts = townPostCountParts(office);
  return parts.length ? parts.map((part) => part.text).join(" · ") : "No mail";
}

/** The counts in full words, for names and announcements. */
export function townPostSpoken(office: TownPostOffice) {
  const parts: string[] = [];
  const { letters, outgoing } = office;
  if (letters.length)
    parts.push(plural(letters.length, "question for you", "questions for you"));
  if (outgoing.waiting)
    parts.push(plural(outgoing.waiting, "answer to send", "answers to send"));
  if (outgoing.checks)
    parts.push(plural(outgoing.checks, "answer to check", "answers to check"));
  return parts.length ? parts.join(", ") : "no mail";
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
export const TOWN_POST_TROLLEY = { fromRight: 30, y: 18, w: 22 } as const;

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

/**
 * Where the sign hangs, in world pixels, its bottom edge on the eave: on a
 * wide town from the eave's right end, growing left over the house; on a
 * narrow (phone) town, whose post office is a few fingers wide, from its
 * left end, growing right as a narrow plate with a count per row.
 */
export function townPostSignAt(lot: TownPostLot, narrow = false) {
  const y = lot.y * TOWN_TILE + 34;
  return narrow
    ? { x: lot.x * TOWN_TILE + 4, y }
    : { x: (lot.x + lot.w) * TOWN_TILE - 12, y };
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
