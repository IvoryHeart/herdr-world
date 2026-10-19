import { useSyncExternalStore } from "react";
import {
  bridge,
  type BridgeControlMsg,
  type ConnectionStatus,
} from "../../api";

/**
 * The browser's view of Board's saved state in the World service
 * (server/src/world/board-store.ts): layout, notes and strings.
 */

export type BoardPoint = { x: number; y: number };
export type NoteColor = "yellow" | "pink" | "blue" | "green";
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
export const NOTE_COLORS: readonly NoteColor[] = [
  "yellow",
  "pink",
  "blue",
  "green",
];
export type BoardAnchor = {
  connection_id: string;
  kind: "workspace" | "tab" | "pane";
  native_id: string;
  witness: string[];
  /** For a pane: the agent the string is for, recorded by the service. */
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
  detached?: boolean;
};
export type BoardDocument = {
  version: 1;
  revision: number;
  layout: {
    anchors: Record<string, BoardPoint>;
    offsets: Record<string, BoardPoint>;
    pinned: Record<string, BoardPoint>;
    folded: string[];
    /** Card key to the colour the user chose; absent before card colours. */
    colors?: Record<string, CardColor>;
  };
  notes: BoardNote[];
  strings: BoardString[];
};
export type BoardOp =
  | { op: "note.put"; note: Omit<BoardNote, "rev">; rev?: number }
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
      unpinned?: string[];
      folded?: string[];
      replace?: boolean;
    }
  | { op: "card.color"; key: string; color: CardColor | null }
  | {
      op: "anchor.witness";
      string_id: string;
      end: "from" | "to";
      witness: string[];
    };

export type BoardDocumentState = {
  document: BoardDocument | null;
  /** The last error or conflict, for a notice. */
  error: string | null;
};

export type BoardClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const isDocument = (value: unknown): value is BoardDocument =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as BoardDocument).version === 1 &&
  Array.isArray((value as BoardDocument).notes) &&
  Array.isArray((value as BoardDocument).strings);

export class BoardDocumentStore {
  private state: BoardDocumentState = { document: null, error: null };
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly client: BoardClient) {}

  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start() {
    if (this.unlisten.length) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (
          control.type === "world_board_changed" &&
          (control.revision ?? 0) > (this.state.document?.revision ?? -1)
        )
          void this.refresh();
      }),
      this.client.onStatus((status) => {
        if (status === "connected") void this.refresh();
      }),
    ];
    void this.refresh();
  }

  stop() {
    for (const off of this.unlisten) off();
    this.unlisten = [];
  }

  async refresh() {
    try {
      const document = await this.client.call("world.board.get");
      if (
        isDocument(document) &&
        document.revision >= (this.state.document?.revision ?? -1)
      )
        this.set({ document, error: null });
    } catch (error) {
      this.set({
        ...this.state,
        error: String(error instanceof Error ? error.message : error),
      });
    }
  }

  /**
   * Apply operations in order, one patch at a time. A conflict replaces the
   * local document with the service's and returns its message.
   */
  patch(ops: BoardOp[]): Promise<string | null> {
    const run = this.queue.then(async () => {
      try {
        const result = (await this.client.call("world.board.patch", {
          ops,
        })) as {
          document?: unknown;
          conflict?: string;
        };
        if (isDocument(result?.document))
          this.set({
            document: result.document,
            error: result.conflict ?? null,
          });
        return result?.conflict ?? null;
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        this.set({ ...this.state, error: message });
        return message;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private set(state: BoardDocumentState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export function useBoardDocument(store: BoardDocumentStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

let shared: BoardDocumentStore | null = null;
/** The board store for World's own bridge, created on first use. */
export function sharedBoardStore() {
  shared ??= new BoardDocumentStore(bridge);
  return shared;
}
