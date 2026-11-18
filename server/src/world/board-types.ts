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
   * Town desks pinned, by their tab's card key: a pinned desk takes its
   * room's first seats and its agents stay at it. `rank` is its place among
   * the room's pinned seats when the user reordered them; `cell` is no longer
   * read. A herdr-core tab's pin is its label: its record only holds a rank.
   */
  desk_pins: Record<string, DeskPin>;
  /**
   * Where the user put Town rooms in their building, by the workspace's card
   * key: tiles from the building's corner. A room without one is stacked.
   */
  room_pins: Record<string, RoomSpot>;
  /**
   * Which street lot each Town building stands on, by its host's connection
   * ID: its rank in the town's reading order (lowest first). A building
   * without one stands after every placed building, in host order.
   */
  building_pins: Record<string, number>;
  /**
   * Lots per street of a wide Town, saved with the first building move and
   * kept from then on, so a new host's building takes the next free lot and
   * moves none of the placed ones. Absent before any move.
   */
  building_columns?: number;
  /** Terminal key (shared/interest.ts) to the viewer's muted or focused. */
  interest: Record<string, StoredInterest>;
  /** Viewer intent by immutable stored Group ID, separate from membership. */
  group_interest?: Record<string, GroupInterest>;
};
/** A desk's cell in its Town room: column and row, from the top left. */
export type DeskCell = { col: number; row: number };
export type DeskPin = { cell: DeskCell | null; rank?: number };
/** A room's top-left in its Town building: tiles from the building's corner. */
export type RoomSpot = { x: number; y: number };
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
  /**
   * A pinned desk's place among its room's pinned seats. Sets it only on a
   * saved pin unless `create` (a herdr-core tab, pinned by its label).
   */
  | { op: "desk.rank"; key: string; rank: number; create?: boolean }
  /**
   * Where a host's Town rooms stand: replaces every room spot saved for that
   * connection (keys are its workspaces' card keys).
   */
  | {
      op: "room.place";
      connection_id: string;
      spots: Record<string, RoomSpot>;
    }
  /**
   * The order Town's buildings stand in, by connection ID: those named take
   * the lots they hold among the saved ones, in this order; the others keep
   * theirs (a host the viewer's filter hides stays where it stood). `hosts`
   * is every host the viewer knows, in host order: those not saved yet are
   * placed where they stood, after the saved ones. `columns` is the lots per
   * street, kept only if none is saved yet.
   */
  | {
      op: "building.place";
      order: string[];
      hosts: string[];
      columns: number;
    }
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
