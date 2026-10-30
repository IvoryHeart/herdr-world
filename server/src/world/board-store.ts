import {
  interests,
  groupInterests,
  applyBoardInterest,
  pruneGroupInterest,
  checkGroupInterest,
} from "./board-interest";
import {
  colorFollowOps,
  trackColorEdits,
  type ColorEdit,
} from "./board-color-moves";
import {
  captureAppearanceChanges,
  trackAppearanceEdits,
  type AppearanceEdits,
} from "./appearance-edits";
import { movedAppearanceOps } from "./appearance-observation";
import {
  restoreAppearance,
  pruneAppearances,
  relocateAppearance,
  applyAppearance,
  parseAppearanceRecords,
  type AppearanceFields,
  type AppearanceTarget,
  type AppearanceRecords,
  type AppearanceRecord,
} from "../../../shared/appearance";
import {
  checkStoredGroups,
  parseStoredGroup,
  parseGroupChanges,
} from "../../../shared/groups";
import {
  applyGroupOp,
  isGroupOp,
  recordGroupChanges,
  type GroupOp,
} from "./board-groups";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { replaceDataFile } from "../config/data-paths";
import { RECIPIENT_MAX, type ObservedAgent } from "./board-recipient";
import { cardKey, tabCardKey } from "../../../shared/terminalColor";
import {
  leaveGroups,
  RELATION_LIMITS,
  terminalKey,
  type RelationsDocument,
  type SpawnClaim,
  type TerminalRef,
} from "../../../shared/relations";
import {
  type StoredInterest,
  type GroupInterest,
} from "../../../shared/interest";

/**
 * Board's saved state: layout, notes and strings. One document for the World
 * service; every Herdr anchor is qualified by its connection profile. Bounded,
 * revisioned and written atomically. Notes are user content: they stay on the
 * service host and its authenticated World clients, and reach Herdr or an
 * agent only when the user sends one.
 */

export type BoardPoint = { x: number; y: number };
export type NoteColor = "yellow" | "pink" | "blue" | "green";
export type BoardAnchorKind = "workspace" | "tab" | "pane";

/** A Herdr target, with the terminal IDs last seen in it as a witness. */
export type BoardAnchor = {
  connection_id: string;
  kind: BoardAnchorKind;
  native_id: string;
  witness: string[];
  /**
   * For a pane, the agent the string was made for (board-recipient.ts).
   * Only the service sets it; absent until the service has read the pane.
   */
  recipient?: string;
};
export type BoardEnd = { note: string } | { anchor: BoardAnchor };

export type BoardNote = {
  id: string;
  text: string;
  color: NoteColor;
  x: number;
  y: number;
  rev: number;
};
export type BoardString = {
  id: string;
  from: BoardEnd;
  to: BoardEnd;
  /** Its target is gone (Herdr said so); it waits in Needs a home. */
  detached?: boolean;
};
/** Colours the user gives workspace and tab cards; status colours are separate. */
export type CardColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink";
export type BoardLayoutDocument = {
  anchors: Record<string, BoardPoint>;
  offsets: Record<string, BoardPoint>;
  pinned: Record<string, BoardPoint>;
  folded: string[];
  /** Card key to the colour the user chose for it. */
  colors: Record<string, CardColor>;
  /**
   * Town desks the user pinned, by their tab's card key: a pinned desk keeps
   * its cell (null until Town first places it), and its agents stay at it.
   */
  desk_pins: Record<string, DeskPin>;
  /** Terminal key (shared/interest.ts) to the viewer's muted or focused. */
  interest: Record<string, StoredInterest>;
  /** Viewer intent by immutable stored Group ID, separate from membership. */
  group_interest?: Record<string, GroupInterest>;
};
/** A desk's cell in its Town room: column and row, from the top left. */
export type DeskCell = { col: number; row: number };
export type DeskPin = { cell: DeskCell | null };
export type BoardDocument = {
  appearance?: AppearanceRecords;
  version: 1;
  revision: number;
  layout: BoardLayoutDocument;
  notes: BoardNote[];
  strings: BoardString[];
  /** Which terminals know each other (shared/relations.ts). */
  relations: RelationsDocument;
};

export type BoardOp =
  | { op: "appearance.prune"; keys: string[] }
  | { op: "appearance.set"; target: AppearanceTarget; fields: AppearanceFields }
  | {
      op: "appearance.relocate";
      from: AppearanceTarget;
      target: AppearanceTarget;
    }
  | { op: "appearance.restore"; key: string; record: AppearanceRecord | null }
  | {
      op: "note.put";
      note: Omit<BoardNote, "rev">;
      /** The revision the client edited; omitted when creating. */
      rev?: number;
    }
  | { op: "note.delete"; id: string; rev: number }
  | { op: "string.put"; string: BoardString }
  | { op: "string.delete"; id: string }
  | {
      op: "string.detach";
      id: string;
      /**
       * Detach only if this end still names this target: a move may have
       * rewritten the string while the absence check was in flight.
       */
      if_anchor?: {
        end: "from" | "to";
        connection_id: string;
        kind: "workspace" | "tab" | "pane";
        native_id: string;
      };
    }
  | {
      op: "layout.set";
      anchors?: Record<string, BoardPoint>;
      offsets?: Record<string, BoardPoint>;
      pinned?: Record<string, BoardPoint>;
      /** Keys that are no longer pinned. */
      unpinned?: string[];
      folded?: string[];
      /**
       * Replace anchors, offsets and pinned positions instead of merging, so
       * entries for cards that are gone do not accumulate. The browser holds
       * the whole layout, including hosts that are offline.
       */
      replace?: boolean;
    }
  | { op: "card.color"; key: string; color: CardColor | null }
  /** Pin a Town desk; a null cell is filled in by Town (`desk.place`). */
  | { op: "desk.pin"; key: string; cell: DeskCell | null }
  | { op: "desk.unpin"; key: string }
  /** Record where Town put a pinned desk; only a desk still pinned, unplaced. */
  | { op: "desk.place"; key: string; cell: DeskCell }
  /** Mute or focus an agent's terminal, or return it to watching with null. */
  | { op: "interest.set"; key: string; interest: StoredInterest | null }
  | { op: "group.interest"; id: string; interest: GroupInterest | null }
  | {
      op: "anchor.witness";
      string_id: string;
      end: "from" | "to";
      witness: string[];
    }
  | GroupOp
  | {
      /** Service only: the spawn claims it saw on Herdr panes. */
      op: "spawn.record";
      claims: SpawnClaim[];
    }
  | {
      /** Service only: drop claims and group members whose terminals closed. */
      op: "relations.prune";
      children: TerminalRef[];
      members: TerminalRef[];
    }
  | {
      /** Service only: record which agent a pane end is for. */
      op: "anchor.recipient";
      string_id: string;
      end: "from" | "to";
      /** Applies only while the end still names this host, pane and terminal. */
      connection_id: string;
      pane_id: string;
      terminal_id: string;
      recipient: string;
    };

/**
 * Operations as a browser may send them: which agent a string is for is the
 * service's to record, so a client cannot set or claim it. A pane anchor may
 * carry what the browser showed in the pane (`observed`); it is taken out
 * and returned for this save only, never stored.
 */
export function clientBoardOps(
  ops: unknown,
  document?: BoardDocument,
): {
  ops: BoardOp[];
  observed: Map<string, ObservedAgent>;
} {
  if (!Array.isArray(ops)) fail("ops must be an array");
  const observed = new Map<string, ObservedAgent>();
  const clean = ops.map((op) => {
    if (!isObject(op)) fail("op must be an object");
    if (
      op.op === "card.color" &&
      Object.values(document?.appearance ?? {}).some(
        (record) => record.kind === "tab" && record.color_key === op.key,
      )
    )
      fail("tab colours require qualified appearance admission");
    if (
      op.op === "appearance.prune" ||
      op.op === "appearance.restore" ||
      op.op === "appearance.relocate" ||
      op.op === "appearance.set" ||
      op.op === "anchor.recipient" ||
      op.op === "spawn.record" ||
      op.op === "relations.prune"
    )
      fail("unknown operation");
    if (op.op !== "string.put" || !isObject(op.string)) return op as BoardOp;
    const string = op.string;
    const strip = (end: unknown, side: "from" | "to") => {
      if (!isObject(end) || !isObject(end.anchor)) return end;
      const anchor = { ...end.anchor };
      const seen = anchor.observed;
      delete anchor.recipient;
      delete anchor.observed;
      if (
        typeof string.id === "string" &&
        isObject(seen) &&
        typeof seen.agent === "string" &&
        seen.agent.length <= BOARD_LIMITS.key
      )
        observed.set(`${string.id}:${side}`, {
          agent: seen.agent,
          ...(isObject(seen.session) ? { session: seen.session } : {}),
        });
      return { ...end, anchor };
    };
    return {
      ...op,
      string: {
        ...string,
        from: strip(string.from, "from"),
        to: strip(string.to, "to"),
      },
    } as BoardOp;
  });
  return { ops: clean, observed };
}

export const BOARD_LIMITS = Object.freeze({
  notes: 500,
  noteText: 4_000,
  strings: 2_000,
  layoutEntries: 2_000,
  witness: 16,
  key: 512,
  ops: 500,
  bytes: 2_000_000,
});

export class BoardConflictError extends Error {
  constructor(
    message: string,
    readonly document: BoardDocument,
  ) {
    super(message);
    this.name = "BoardConflictError";
  }
}

const COLORS: readonly NoteColor[] = ["yellow", "pink", "blue", "green"];
const KINDS: readonly BoardAnchorKind[] = ["workspace", "tab", "pane"];
export const CARD_COLORS: readonly CardColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
];

export function emptyBoardDocument(): BoardDocument {
  return {
    version: 1,
    revision: 0,
    layout: {
      anchors: {},
      offsets: {},
      pinned: {},
      folded: [],
      colors: {},
      desk_pins: {},
      interest: {},
      group_interest: {},
    },
    notes: [],
    strings: [],
    relations: { spawns: [], groups: [] },
  };
}

/* ---------- Validation ---------- */

function fail(message: string): never {
  throw new Error(`invalid board: ${message}`);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, what: string, max: number, empty = false) {
  if (typeof value !== "string" || value.length > max || (!empty && !value))
    fail(`${what} must be a string of at most ${max} characters`);
  return value;
}
function point(value: unknown, what: string): BoardPoint {
  if (
    !isObject(value) ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    Math.abs(value.x as number) > 1e7 ||
    Math.abs(value.y as number) > 1e7
  )
    fail(`${what} must be a point`);
  return { x: value.x as number, y: value.y as number };
}
function points(value: unknown, what: string): Record<string, BoardPoint> {
  if (value === undefined) return {};
  if (!isObject(value)) fail(`${what} must be an object`);
  const out: Record<string, BoardPoint> = {};
  for (const [key, entry] of Object.entries(value)) {
    text(key, `${what} key`, BOARD_LIMITS.key);
    out[key] = point(entry, `${what}.${key}`);
  }
  return out;
}
function keys(value: unknown, what: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${what} must be a list`);
  return value.map((key) => text(key, `${what} entry`, BOARD_LIMITS.key));
}
function colors(value: unknown): Record<string, CardColor> {
  if (value === undefined) return {};
  if (!isObject(value)) fail("colors must be an object");
  const out: Record<string, CardColor> = {};
  for (const [key, entry] of Object.entries(value)) {
    text(key, "colors key", BOARD_LIMITS.key);
    if (!CARD_COLORS.includes(entry as CardColor)) fail("card colour");
    out[key] = entry as CardColor;
  }
  return out;
}
/** Town rooms are at most this many cells across or down. */
const DESK_CELL_MAX = 64;
function deskCell(value: unknown): DeskCell {
  const index = (entry: unknown) =>
    Number.isSafeInteger(entry) &&
    (entry as number) >= 0 &&
    (entry as number) < DESK_CELL_MAX;
  if (!isObject(value) || !index(value.col) || !index(value.row))
    fail("desk cell");
  return { col: value.col as number, row: value.row as number };
}
function deskPins(value: unknown): Record<string, DeskPin> {
  if (value === undefined) return {};
  if (!isObject(value)) fail("desk_pins must be an object");
  const out: Record<string, DeskPin> = {};
  for (const [key, entry] of Object.entries(value)) {
    text(key, "desk_pins key", BOARD_LIMITS.key);
    if (!isObject(entry)) fail("desk pin");
    out[key] = { cell: entry.cell === null ? null : deskCell(entry.cell) };
  }
  return out;
}

function anchor(value: unknown): BoardAnchor {
  if (!isObject(value)) fail("anchor must be an object");
  if (!KINDS.includes(value.kind as BoardAnchorKind)) fail("anchor kind");
  const witness = keys(value.witness, "anchor witness");
  if (witness.length > BOARD_LIMITS.witness) fail("anchor witness is too long");
  return {
    connection_id: text(
      value.connection_id,
      "anchor connection",
      BOARD_LIMITS.key,
    ),
    kind: value.kind as BoardAnchorKind,
    native_id: text(value.native_id, "anchor target", BOARD_LIMITS.key),
    witness,
    ...(value.kind === "pane" && value.recipient !== undefined
      ? { recipient: text(value.recipient, "anchor recipient", RECIPIENT_MAX) }
      : {}),
  };
}
function end(value: unknown): BoardEnd {
  if (!isObject(value)) fail("string end must be an object");
  if ("note" in value)
    return { note: text(value.note, "note id", BOARD_LIMITS.key) };
  return { anchor: anchor(value.anchor) };
}
function note(value: unknown, rev: number): BoardNote {
  if (!isObject(value)) fail("note must be an object");
  if (!COLORS.includes(value.color as NoteColor)) fail("note colour");
  const at = point(value, "note position");
  return {
    id: text(value.id, "note id", BOARD_LIMITS.key),
    text: text(value.text, "note text", BOARD_LIMITS.noteText, true),
    color: value.color as NoteColor,
    x: at.x,
    y: at.y,
    rev,
  };
}
function string(value: unknown): BoardString {
  if (!isObject(value)) fail("string must be an object");
  return {
    id: text(value.id, "string id", BOARD_LIMITS.key),
    from: end(value.from),
    to: end(value.to),
    ...(value.detached === true ? { detached: true } : {}),
  };
}

function terminalRef(value: unknown): TerminalRef {
  if (!isObject(value)) fail("terminal must be an object");
  return {
    connection_id: text(
      value.connection_id,
      "terminal connection",
      BOARD_LIMITS.key,
    ),
    terminal_id: text(value.terminal_id, "terminal ID", BOARD_LIMITS.key),
  };
}
function count(value: unknown, what: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(what);
  return value as number;
}
function spawnClaim(value: unknown): SpawnClaim {
  if (!isObject(value)) fail("spawn claim must be an object");
  return {
    child: terminalRef(value.child),
    parent: terminalRef(value.parent),
    source: text(value.source, "spawn source", BOARD_LIMITS.key),
    generation: count(value.generation, "spawn generation"),
    observed_at: count(value.observed_at, "spawn time"),
  };
}
function relations(value: unknown): RelationsDocument {
  // Boards saved before relations have none.
  if (value === undefined) return { spawns: [], groups: [] };
  if (!isObject(value)) fail("relations must be an object");
  if (!Array.isArray(value.spawns) || !Array.isArray(value.groups))
    fail("relations");
  return {
    spawns: value.spawns.map(spawnClaim),
    groups: value.groups.map(parseStoredGroup),
    ...(value.group_changes === undefined
      ? {}
      : { group_changes: parseGroupChanges(value.group_changes) }),
  };
}

/** Parse a stored document strictly; anything unexpected is rejected. */
export function parseBoardDocument(value: unknown): BoardDocument {
  if (!isObject(value) || value.version !== 1) fail("unsupported version");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
    fail("revision");
  const layout = isObject(value.layout) ? value.layout : fail("layout");
  const notes = Array.isArray(value.notes) ? value.notes : fail("notes");
  const strings = Array.isArray(value.strings)
    ? value.strings
    : fail("strings");
  const document: BoardDocument = {
    version: 1,
    revision: value.revision as number,
    ...(value.appearance === undefined
      ? {}
      : { appearance: parseAppearanceRecords(value.appearance) }),
    layout: {
      anchors: points(layout.anchors, "anchors"),
      offsets: points(layout.offsets, "offsets"),
      pinned: points(layout.pinned, "pinned"),
      folded: keys(layout.folded, "folded"),
      // Boards saved before card colours have none.
      colors: colors(layout.colors),
      // Boards saved before desk pins have none.
      desk_pins: deskPins(layout.desk_pins),
      // Boards saved before interest have none: every agent is watched.
      interest: interests(layout.interest, BOARD_LIMITS.key),
      group_interest: groupInterests(layout.group_interest, BOARD_LIMITS.key),
    },
    notes: notes.map((entry) => {
      const rev =
        isObject(entry) && Number.isSafeInteger(entry.rev)
          ? (entry.rev as number)
          : fail("note rev");
      return note(entry, rev);
    }),
    strings: strings.map(string),
    relations: relations(value.relations),
  };
  checkBounds(document);
  return document;
}

function checkBounds(document: BoardDocument) {
  const { layout } = document;
  if (document.notes.length > BOARD_LIMITS.notes)
    fail(`at most ${BOARD_LIMITS.notes} notes`);
  if (document.strings.length > BOARD_LIMITS.strings)
    fail(`at most ${BOARD_LIMITS.strings} strings`);
  const entries =
    Object.keys(layout.anchors).length +
    Object.keys(layout.offsets).length +
    Object.keys(layout.pinned).length +
    layout.folded.length +
    Object.keys(layout.colors).length +
    Object.keys(layout.desk_pins).length +
    Object.keys(layout.interest).length +
    Object.keys(layout.group_interest ?? {}).length;
  if (entries > BOARD_LIMITS.layoutEntries)
    fail(`at most ${BOARD_LIMITS.layoutEntries} layout entries`);
  const noteIds = new Set(document.notes.map((entry) => entry.id));
  if (noteIds.size !== document.notes.length) fail("duplicate note ids");
  const stringIds = new Set(document.strings.map((entry) => entry.id));
  if (stringIds.size !== document.strings.length) fail("duplicate string ids");
  for (const entry of document.strings)
    for (const side of [entry.from, entry.to])
      if ("note" in side && !noteIds.has(side.note))
        fail("a string refers to a missing note");
  const { spawns, groups } = document.relations;
  if (spawns.length > RELATION_LIMITS.spawns)
    fail(`at most ${RELATION_LIMITS.spawns} spawn claims`);
  if (groups.length > RELATION_LIMITS.groups)
    fail(`at most ${RELATION_LIMITS.groups} groups`);
  const children = new Set(spawns.map((claim) => terminalKey(claim.child)));
  if (children.size !== spawns.length) fail("one spawn claim per child");
  checkStoredGroups(groups);
  checkGroupInterest(document);
  if (
    document.relations.group_changes?.some(
      (event) => event.revision > document.revision,
    )
  )
    fail("group event revision is newer than the board");
}

/* ---------- Store ---------- */

export class BoardStore {
  private document: BoardDocument;
  private readonly colorEdits = new Map<string, ColorEdit>();
  private readonly appearanceEdits: AppearanceEdits = new Map();

  constructor(
    private readonly path: string,
    private readonly options: {
      now?: () => number;
      log?: (message: string) => void;
    } = {},
  ) {
    this.document = this.load();
  }

  private load(): BoardDocument {
    if (!existsSync(this.path)) return emptyBoardDocument();
    try {
      return parseBoardDocument(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      // Keep the unreadable file for recovery and start an empty board.
      const aside = `${this.path}.unreadable-${(this.options.now ?? Date.now)()}`;
      try {
        renameSync(this.path, aside);
      } catch {
        // Leave it where it is; the next save replaces it.
      }
      this.options.log?.(
        `board store unreadable (${String(error)}); kept at ${aside}`,
      );
      return emptyBoardDocument();
    }
  }

  get(): BoardDocument {
    return structuredClone(this.document);
  }

  /** In-flight moves distinguish explicit edits from native close cleanup. */
  captureColorChanges(): (key: string) => CardColor | null | undefined {
    const captured = new Map(this.colorEdits);
    return (key) => {
      const edit = this.colorEdits.get(key);
      return edit && captured.get(key)?.revision !== edit.revision
        ? edit.color
        : undefined;
    };
  }

  captureAppearanceChanges() {
    return captureAppearanceChanges(
      this.appearanceEdits,
      this.document.revision,
      () => this.document,
    );
  }

  /**
   * Apply every operation or none. A note edit made against an older note
   * revision is refused with the current document, so a second client never
   * overwrites a newer note.
   */
  patch(ops: readonly BoardOp[]): BoardDocument {
    if (!Array.isArray(ops) || ops.length > BOARD_LIMITS.ops)
      fail(`1 to ${BOARD_LIMITS.ops} operations`);
    const next = structuredClone(this.document);
    const now = (this.options.now ?? Date.now)();
    for (const op of ops) applyOp(next, op, this.document, now);
    pruneGroupInterest(next);
    next.revision = this.document.revision + 1;
    checkBounds(next);
    const payload = JSON.stringify(next);
    if (payload.length > BOARD_LIMITS.bytes) fail("the board is too large");
    replaceDataFile(this.path, payload);
    this.document = next;
    trackColorEdits(this.colorEdits, ops, next);
    trackAppearanceEdits(this.appearanceEdits, ops, next);
    return this.get();
  }
  /**
   * Apply the operations only if the board is still at `revision`; null when
   * a newer edit landed meanwhile, so the caller can read again.
   */
  patchIf(revision: number, ops: readonly BoardOp[]): BoardDocument | null {
    return this.document.revision === revision ? this.patch(ops) : null;
  }
}

function applyOp(
  next: BoardDocument,
  op: BoardOp,
  current: BoardDocument,
  now: number,
) {
  if (!isObject(op)) fail("operation must be an object");
  if (isGroupOp(op)) {
    try {
      applyGroupOp(next.relations, op as GroupOp, now, current.revision + 1);
      if (op.op === "group.delete" && next.layout.group_interest)
        delete next.layout.group_interest[
          (op as Extract<GroupOp, { op: "group.delete" }>).id
        ];
    } catch (error) {
      fail((error as Error).message);
    }
    return;
  }
  switch (op.op) {
    case "note.put": {
      const existing = next.notes.findIndex(
        (entry) => entry.id === op.note?.id,
      );
      if (existing < 0) {
        if (op.rev !== undefined)
          throw new BoardConflictError("That note was deleted.", current);
        next.notes.push(note(op.note, 1));
      } else {
        if (op.rev !== next.notes[existing]!.rev)
          throw new BoardConflictError("That note changed elsewhere.", current);
        next.notes[existing] = note(op.note, next.notes[existing]!.rev + 1);
      }
      return;
    }
    case "note.delete": {
      const existing = next.notes.find((entry) => entry.id === op.id);
      if (!existing) return;
      if (existing.rev !== op.rev)
        throw new BoardConflictError("That note changed elsewhere.", current);
      next.notes = next.notes.filter((entry) => entry.id !== op.id);
      // A note's strings go with it.
      next.strings = next.strings.filter(
        (entry) =>
          !("note" in entry.from && entry.from.note === op.id) &&
          !("note" in entry.to && entry.to.note === op.id),
      );
      return;
    }
    case "string.put": {
      const parsed = string(op.string);
      next.strings = next.strings.filter((entry) => entry.id !== parsed.id);
      next.strings.push(parsed);
      return;
    }
    case "string.delete":
      next.strings = next.strings.filter((entry) => entry.id !== op.id);
      return;
    case "string.detach": {
      const target = next.strings.find((entry) => entry.id === op.id);
      if (!target) return;
      const expected = op.if_anchor;
      if (expected) {
        const side = target[expected.end === "to" ? "to" : "from"];
        if (
          !("anchor" in side) ||
          side.anchor.connection_id !== expected.connection_id ||
          side.anchor.kind !== expected.kind ||
          side.anchor.native_id !== expected.native_id
        )
          return;
      }
      target.detached = true;
      return;
    }
    case "layout.set": {
      if (op.replace === true) {
        next.layout.anchors = {};
        next.layout.offsets = {};
        next.layout.pinned = {};
      }
      Object.assign(next.layout.anchors, points(op.anchors, "anchors"));
      Object.assign(next.layout.offsets, points(op.offsets, "offsets"));
      Object.assign(next.layout.pinned, points(op.pinned, "pinned"));
      for (const key of keys(op.unpinned, "unpinned"))
        delete next.layout.pinned[key];
      if (op.folded !== undefined)
        next.layout.folded = keys(op.folded, "folded");
      return;
    }
    case "appearance.prune":
      pruneAppearances(next, op.keys);
      return;
    case "appearance.restore":
      restoreAppearance(next, op.key, op.record);
      return;
    case "appearance.relocate":
      relocateAppearance(next, op.from, op.target);
      return;
    case "appearance.set":
      applyAppearance(next, op.target, op.fields);
      return;
    case "card.color": {
      const key = text(op.key, "card key", BOARD_LIMITS.key);
      if (op.color === null) delete next.layout.colors[key];
      else if (CARD_COLORS.includes(op.color))
        next.layout.colors[key] = op.color;
      else fail("card colour");
      return;
    }
    case "spawn.record": {
      if (!Array.isArray(op.claims)) fail("claims must be a list");
      const claims = op.claims.map(spawnClaim);
      const replaced = new Set(claims.map((claim) => terminalKey(claim.child)));
      const kept = next.relations.spawns.filter(
        (claim) => !replaced.has(terminalKey(claim.child)),
      );
      // The oldest claims give way when the bound is reached.
      next.relations.spawns = [...kept, ...claims].slice(
        -RELATION_LIMITS.spawns,
      );
      return;
    }
    case "relations.prune": {
      // A restarted Herdr closes every saved terminal at once.
      const refs = (value: unknown, what: string) => {
        if (!Array.isArray(value)) fail(`${what} must be a list`);
        return value.map(terminalRef);
      };
      const children = new Set(refs(op.children, "children").map(terminalKey));
      next.relations.spawns = next.relations.spawns.filter(
        (claim) => !children.has(terminalKey(claim.child)),
      );
      const before = next.relations.groups;
      next.relations.groups = leaveGroups(before, refs(op.members, "members"));
      recordGroupChanges(
        next.relations,
        before,
        op.op,
        { basis: "unknown", via: "service" },
        now,
        current.revision + 1,
      );
      return;
    }
    case "desk.pin": {
      const key = text(op.key, "desk key", BOARD_LIMITS.key);
      next.layout.desk_pins[key] = {
        cell: op.cell === null ? null : deskCell(op.cell),
      };
      return;
    }
    case "desk.unpin":
      delete next.layout.desk_pins[text(op.key, "desk key", BOARD_LIMITS.key)];
      return;
    case "desk.place": {
      // Never re-pins a desk unpinned meanwhile, nor moves a placed one.
      const pin =
        next.layout.desk_pins[text(op.key, "desk key", BOARD_LIMITS.key)];
      const cell = deskCell(op.cell);
      if (pin && !pin.cell) pin.cell = cell;
      return;
    }
    case "interest.set":
    case "group.interest":
      applyBoardInterest(next, op, BOARD_LIMITS.key);
      return;
    case "anchor.witness": {
      const target = next.strings.find((entry) => entry.id === op.string_id);
      const side = target?.[op.end === "to" ? "to" : "from"];
      if (!side || !("anchor" in side)) fail("no such anchored string end");
      const witness = keys(op.witness, "witness");
      if (witness.length > BOARD_LIMITS.witness) fail("witness is too long");
      side.anchor.witness = witness;
      // A new terminal holds a different agent; the service reads it again.
      delete side.anchor.recipient;
      return;
    }
    case "anchor.recipient": {
      const target = next.strings.find((entry) => entry.id === op.string_id);
      const side = target?.[op.end === "to" ? "to" : "from"];
      if (
        !side ||
        !("anchor" in side) ||
        side.anchor.kind !== "pane" ||
        side.anchor.connection_id !== op.connection_id ||
        side.anchor.native_id !== op.pane_id ||
        !side.anchor.witness.includes(op.terminal_id)
      )
        return;
      side.anchor.recipient = text(
        op.recipient,
        "anchor recipient",
        RECIPIENT_MAX,
      );
      return;
    }
    default:
      fail("unknown operation");
  }
}

/**
 * After a move in any view: anchors to a moved pane take its new ID (moved
 * panes keep their terminals, so witnesses stay), and anchors to a moved tab
 * take its new tab ID; with `colors`, the tab keeps its colour. Returns the
 * updates to save, if any.
 */
export function moveFollowOps(
  document: BoardDocument,
  connectionId: string,
  movedTab: string | null,
  moved: {
    tab_id: string;
    workspace_id?: string;
    source_workspace_id?: string;
    panes: readonly { previous: string; current: string }[];
  },
  colors?: MoveColors,
): BoardOp[] {
  const panes = new Map(
    moved.panes.map((pane) => [pane.previous, pane.current]),
  );
  const rewrite = (end: BoardEnd): BoardEnd => {
    if (!("anchor" in end) || end.anchor.connection_id !== connectionId)
      return end;
    const { anchor } = end;
    if (anchor.kind === "pane" && panes.has(anchor.native_id))
      return { anchor: { ...anchor, native_id: panes.get(anchor.native_id)! } };
    if (anchor.kind === "tab" && movedTab && anchor.native_id === movedTab)
      return { anchor: { ...anchor, native_id: moved.tab_id } };
    return end;
  };
  const ops: BoardOp[] = [];
  for (const string of document.strings) {
    const from = rewrite(string.from),
      to = rewrite(string.to);
    if (from !== string.from || to !== string.to)
      ops.push({ op: "string.put", string: { ...string, from, to } });
  }
  if (movedTab && colors) {
    ops.push(...colorFollowOps(connectionId, movedTab, moved, colors));
    ops.push(...pinFollowOps(document, connectionId, movedTab, moved, colors));
  }
  ops.push(
    ...movedAppearanceOps(
      document,
      connectionId,
      movedTab,
      moved,
      colors?.workspaceIds ?? new Set(),
    ),
  );
  return ops;
}

/**
 * A pinned desk stays pinned when its tab moves to another workspace: the pin
 * takes the tab's new key, and Town places it afresh in its new room.
 */
function pinFollowOps(
  document: BoardDocument,
  connectionId: string,
  movedTab: string,
  moved: { tab_id: string; workspace_id?: string },
  { workspaceIds }: MoveColors,
): BoardOp[] {
  const previousKey = tabCardKey(connectionId, movedTab, workspaceIds);
  const nextKey = tabCardKey(connectionId, moved.tab_id, workspaceIds);
  if (previousKey === nextKey || !document.layout.desk_pins[previousKey])
    return [];
  return [
    { op: "desk.pin", key: nextKey, cell: null },
    { op: "desk.unpin", key: previousKey },
  ];
}

/** The colours before a move, and the host's workspace IDs for tab keys. */
export type MoveColors = {
  before: Readonly<Record<string, CardColor>>;
  workspaceIds: ReadonlySet<string>;
  /** The browser showed the tab with its parent's colour (relations). */
  inherited?: boolean;
};

/**
 * After Herdr closes a tab on the current runtime, its saved colour and desk
 * pin go. The
 * plain key is dropped only when no workspace holds that ID (older Herdr can
 * reuse one), which the caller checks with Herdr as Board's detach does.
 */
export function tabClosedOps(
  document: BoardDocument,
  connectionId: string,
  tabId: string,
  workspaceAbsent: boolean,
): BoardOp[] {
  const keys = [cardKey(connectionId, `tab:${tabId}`)];
  if (workspaceAbsent) keys.push(cardKey(connectionId, tabId));
  return keys.flatMap((key): BoardOp[] => [
    ...(document.layout.colors[key]
      ? [{ op: "card.color" as const, key, color: null }]
      : []),
    ...(document.layout.desk_pins[key]
      ? [{ op: "desk.unpin" as const, key }]
      : []),
  ]);
}

// Moved out so this module stays within the size ratchet; importers keep it.
export { reconcileOps } from "./board-reconcile";
