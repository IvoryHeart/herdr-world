import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  interestKeyPrefix,
  STORED_INTERESTS,
  type StoredInterest,
} from "../../../shared/interest";
import {
  cardKey,
  resolveTerminalColor,
  tabCardKey,
} from "../../../shared/terminalColor";
import { dataRoot, replaceDataFile } from "../config/data-paths";
import { worldEnv } from "../config/environment";
import { type ObservedAgent, RECIPIENT_MAX } from "./board-recipient";

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
  /** Terminal key (shared/interest.ts) to the viewer's muted or focused. */
  interest: Record<string, StoredInterest>;
};
export type BoardDocument = {
  version: 1;
  revision: number;
  layout: BoardLayoutDocument;
  notes: BoardNote[];
  strings: BoardString[];
};

export type BoardOp =
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
  /** Mute or focus an agent's terminal, or return it to watching with null. */
  | { op: "interest.set"; key: string; interest: StoredInterest | null }
  | {
      op: "anchor.witness";
      string_id: string;
      end: "from" | "to";
      witness: string[];
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
export function clientBoardOps(ops: unknown): {
  ops: BoardOp[];
  observed: Map<string, ObservedAgent>;
} {
  if (!Array.isArray(ops)) fail("ops must be an array");
  const observed = new Map<string, ObservedAgent>();
  const clean = ops.map((op) => {
    if (!isObject(op)) fail("op must be an object");
    if (op.op === "anchor.recipient") fail("unknown operation");
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
      interest: {},
    },
    notes: [],
    strings: [],
  };
}

export function defaultBoardPath() {
  return worldEnv("BOARD_PATH") ?? join(dataRoot(), "boards", "board.json");
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
function interests(value: unknown): Record<string, StoredInterest> {
  if (value === undefined) return {};
  if (!isObject(value)) fail("interest must be an object");
  const out: Record<string, StoredInterest> = {};
  for (const [key, entry] of Object.entries(value)) {
    text(key, "interest key", BOARD_LIMITS.key);
    if (!STORED_INTERESTS.includes(entry as StoredInterest)) fail("interest");
    out[key] = entry as StoredInterest;
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
    layout: {
      anchors: points(layout.anchors, "anchors"),
      offsets: points(layout.offsets, "offsets"),
      pinned: points(layout.pinned, "pinned"),
      folded: keys(layout.folded, "folded"),
      // Boards saved before card colours have none.
      colors: colors(layout.colors),
      // Boards saved before interest have none: every agent is watched.
      interest: interests(layout.interest),
    },
    notes: notes.map((entry) => {
      const rev =
        isObject(entry) && Number.isSafeInteger(entry.rev)
          ? (entry.rev as number)
          : fail("note rev");
      return note(entry, rev);
    }),
    strings: strings.map(string),
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
    Object.keys(layout.interest).length;
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
}

/* ---------- Store ---------- */

export class BoardStore {
  private document: BoardDocument;

  constructor(
    private readonly path: string = defaultBoardPath(),
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

  /**
   * Apply every operation or none. A note edit made against an older note
   * revision is refused with the current document, so a second client never
   * overwrites a newer note.
   */
  patch(ops: readonly BoardOp[]): BoardDocument {
    if (!Array.isArray(ops) || ops.length > BOARD_LIMITS.ops)
      fail(`1 to ${BOARD_LIMITS.ops} operations`);
    const next = structuredClone(this.document);
    for (const op of ops) applyOp(next, op, this.document);
    next.revision = this.document.revision + 1;
    checkBounds(next);
    const payload = JSON.stringify(next);
    if (payload.length > BOARD_LIMITS.bytes) fail("the board is too large");
    replaceDataFile(this.path, payload);
    this.document = next;
    return this.get();
  }
}

function applyOp(next: BoardDocument, op: BoardOp, current: BoardDocument) {
  if (!isObject(op)) fail("operation must be an object");
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
    case "card.color": {
      const key = text(op.key, "card key", BOARD_LIMITS.key);
      if (op.color === null) delete next.layout.colors[key];
      else if (CARD_COLORS.includes(op.color))
        next.layout.colors[key] = op.color;
      else fail("card colour");
      return;
    }
    case "interest.set": {
      const key = text(op.key, "interest key", BOARD_LIMITS.key);
      if (op.interest === null) delete next.layout.interest[key];
      else if (STORED_INTERESTS.includes(op.interest))
        next.layout.interest[key] = op.interest;
      else fail("interest");
      return;
    }
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
  if (movedTab && colors)
    ops.push(...colorFollowOps(connectionId, movedTab, moved, colors));
  return ops;
}

/**
 * A moved tab keeps the colour it showed (shared/terminalColor.ts), chosen,
 * inherited or default: its new tab ID would otherwise give it another
 * default. It is saved as the moved tab's own colour. Read from
 * `colors.before`, taken before the move, so a close of the old tab seen
 * during the move cannot lose it.
 */
function colorFollowOps(
  connectionId: string,
  movedTab: string,
  moved: {
    tab_id: string;
    workspace_id?: string;
    source_workspace_id?: string;
  },
  colors: MoveColors,
): BoardOp[] {
  const { before, workspaceIds } = colors;
  const { source_workspace_id: from, workspace_id: to } = moved;
  if (!from || !to) return [];
  const previousKey = tabCardKey(connectionId, movedTab, workspaceIds);
  const nextKey = tabCardKey(connectionId, moved.tab_id, workspaceIds);
  if (previousKey === nextKey) return [];
  const { color } = resolveTerminalColor(before, {
    connectionId,
    workspaceId: from,
    tabId: movedTab,
    workspaceIds,
  });
  // Always as the tab's own colour: one that merely matched the new room's
  // would otherwise be lost to it, and change when that room is recoloured.
  const ops: BoardOp[] = [
    { op: "card.color", key: nextKey, color: color as CardColor },
  ];
  if (before[previousKey])
    ops.push({ op: "card.color", key: previousKey, color: null });
  return ops;
}

/** The colours before a move, and the host's workspace IDs for tab keys. */
export type MoveColors = {
  before: Readonly<Record<string, CardColor>>;
  workspaceIds: ReadonlySet<string>;
};

/**
 * After Herdr closes a tab on the current runtime, its saved colour goes. The
 * plain key is dropped only when no workspace holds that ID (older Herdr can
 * reuse one), which the caller checks with Herdr as Board's detach does.
 */
export function tabClosedColorOps(
  document: BoardDocument,
  connectionId: string,
  tabId: string,
  workspaceAbsent: boolean,
): BoardOp[] {
  const keys = [cardKey(connectionId, `tab:${tabId}`)];
  if (workspaceAbsent) keys.push(cardKey(connectionId, tabId));
  return keys
    .filter((key) => document.layout.colors[key])
    .map((key) => ({ op: "card.color", key, color: null }));
}

/**
 * Interest records for one host whose terminals are gone. `terminals` must be
 * every terminal of a fresh, complete listing from the host's current
 * runtime; a failed or stale host keeps its records, so pass nothing then.
 */
export function goneInterestOps(
  document: BoardDocument,
  connectionId: string,
  terminals: ReadonlySet<string>,
): BoardOp[] {
  const prefix = interestKeyPrefix(connectionId);
  return Object.keys(document.layout.interest)
    .filter(
      (key) =>
        key.startsWith(prefix) && !terminals.has(key.slice(prefix.length)),
    )
    .map((key) => ({ op: "interest.set", key, interest: null }));
}

/**
 * After a move that failed (and maybe rolled back), panes can sit under new
 * IDs. Using only what the outcome positively observed (terminal to pane and
 * tab), a pane anchor whose witnessed terminal was seen takes that pane's ID,
 * and a tab anchor whose witnessed terminals were all seen in one tab takes
 * that tab.
 * Anchors with no observed terminal are left as they are (unresolved).
 */
export function reconcileOps(
  document: BoardDocument,
  connectionId: string,
  topology: readonly { terminal_id: string; pane_id: string; tab_id: string }[],
): BoardOp[] {
  const byTerminal = new Map(
    topology.map((entry) => [entry.terminal_id, entry]),
  );
  const rewrite = (end: BoardEnd): BoardEnd => {
    if (!("anchor" in end) || end.anchor.connection_id !== connectionId)
      return end;
    const { anchor } = end;
    const seen = anchor.witness.flatMap((terminal) => {
      const entry = byTerminal.get(terminal);
      return entry ? [entry] : [];
    });
    if (!seen.length) return end;
    if (anchor.kind === "pane") {
      const pane = seen[0]!.pane_id;
      return pane === anchor.native_id
        ? end
        : { anchor: { ...anchor, native_id: pane } };
    }
    if (anchor.kind === "tab") {
      // Only when every witnessed terminal was seen, all in one tab: a
      // partial observation may have missed panes still in the old tab.
      if (seen.length !== anchor.witness.length) return end;
      const tabs = new Set(seen.map((entry) => entry.tab_id));
      const [tab] = [...tabs];
      return tabs.size === 1 && tab !== anchor.native_id
        ? { anchor: { ...anchor, native_id: tab! } }
        : end;
    }
    return end;
  };
  const ops: BoardOp[] = [];
  for (const string of document.strings) {
    const from = rewrite(string.from),
      to = rewrite(string.to);
    if (from !== string.from || to !== string.to)
      ops.push({ op: "string.put", string: { ...string, from, to } });
  }
  return ops;
}
