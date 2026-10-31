import type {
  AppearanceFields,
  AppearanceTarget,
  AppearanceRecord,
  AppearanceRecords,
} from "../../../shared/appearance";
import type {
  RelationsDocument,
  TerminalRef,
  SpawnClaim,
} from "../../../shared/relations";
import type { StoredInterest, GroupInterest } from "../../../shared/interest";
import type { GroupOp } from "./board-groups";
import type { AppearanceChanges } from "./appearance-edits";

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

/** Server-only planning retains a measured payload while awaiting committed state. */
export type BoardPlanner = ((
  document: BoardDocument,
) => readonly BoardOp[] | null) & {
  readonly retainedBytes: number;
};
export type BoardPatch = readonly BoardOp[] | BoardPlanner;
export type BoardBacking = {
  read(): BoardDocument;
  commit(document: BoardDocument): void;
};
export type BoardStorePort = {
  get(): BoardDocument;
  patch(ops: BoardPatch): BoardDocument | Promise<BoardDocument>;
  patchIf(
    revision: number,
    ops: BoardPatch,
  ): BoardDocument | null | Promise<BoardDocument | null>;
  captureColorChanges(): (key: string) => CardColor | null | undefined;
  captureAppearanceChanges(): AppearanceChanges;
  settled(): Promise<void>;
  close(): void;
};
