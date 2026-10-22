import { watch } from "node:fs";

export type ConversationIdentity = {
  /** Changes whenever what Chat shows could change. */
  key: string;
  /**
   * Transcripts on this machine to watch between Herdr events: the one shown
   * and any that can still settle a message Chat sent.
   */
  paths: string[];
};

type Watched = {
  owners: Set<object>;
  key: string | null;
  files: Map<string, () => void>;
  timer: ReturnType<typeof setTimeout> | null;
  checking: boolean;
  again: boolean;
};

function watchLocalFile(path: string, onChange: () => void) {
  try {
    const watcher = watch(path, { persistent: false }, onChange);
    watcher.on("error", () => watcher.close());
    return () => watcher.close();
  } catch {
    // A transcript that vanished is noticed on the next Herdr event.
    return () => {};
  }
}

/**
 * Tells browsers when a conversation they show has changed, so Chat needs no
 * timer. A pane is rechecked on every Herdr event for the connection (status
 * changes, title changes, session reports) and, for a local transcript, when
 * the file changes, which covers a long turn. Remote transcripts are only
 * rechecked on Herdr events.
 */
export function createConversationWatcher(args: {
  identity: (paneId: string) => Promise<ConversationIdentity>;
  notify: (paneId: string, owners: ReadonlySet<object>) => void;
  watchFile?: (path: string, onChange: () => void) => () => void;
  debounceMs?: number;
}) {
  const panes = new Map<string, Watched>();
  const watchFile = args.watchFile ?? watchLocalFile;
  const debounceMs = args.debounceMs ?? 150;

  const check = async (paneId: string) => {
    const pane = panes.get(paneId);
    if (!pane) return;
    if (pane.checking) {
      pane.again = true;
      return;
    }
    pane.checking = true;
    try {
      let identity: ConversationIdentity;
      try {
        identity = await args.identity(paneId);
      } catch (error) {
        identity = {
          key: `error:${String(error)}`,
          paths: [...pane.files.keys()],
        };
      }
      if (panes.get(paneId) !== pane) return;
      const changed = pane.key !== null && pane.key !== identity.key;
      pane.key = identity.key;
      for (const [path, stop] of pane.files)
        if (!identity.paths.includes(path)) {
          stop();
          pane.files.delete(path);
        }
      for (const path of identity.paths)
        if (!pane.files.has(path))
          pane.files.set(
            path,
            watchFile(path, () => schedule(paneId)),
          );
      if (changed) args.notify(paneId, pane.owners);
    } finally {
      pane.checking = false;
      if (pane.again && panes.get(paneId) === pane) {
        pane.again = false;
        void check(paneId);
      }
    }
  };

  const schedule = (paneId: string) => {
    const pane = panes.get(paneId);
    if (!pane || pane.timer) return;
    pane.timer = setTimeout(() => {
      pane.timer = null;
      void check(paneId);
    }, debounceMs);
  };

  const drop = (paneId: string, pane: Watched) => {
    for (const stop of pane.files.values()) stop();
    if (pane.timer) clearTimeout(pane.timer);
    panes.delete(paneId);
  };

  return {
    watch(owner: object, paneId: string) {
      let pane = panes.get(paneId);
      if (!pane) {
        pane = {
          owners: new Set(),
          key: null,
          files: new Map(),
          timer: null,
          checking: false,
          again: false,
        };
        panes.set(paneId, pane);
        // The first check records a baseline and notifies nobody.
        void check(paneId);
      }
      pane.owners.add(owner);
    },
    /** Stop one pane for an owner, or every pane when none is named. */
    unwatch(owner: object, paneId?: string) {
      for (const [id, pane] of panes) {
        if (paneId !== undefined && id !== paneId) continue;
        pane.owners.delete(owner);
        if (pane.owners.size === 0) drop(id, pane);
      }
    },
    herdrEvent() {
      for (const paneId of panes.keys()) schedule(paneId);
    },
    stop() {
      for (const [id, pane] of panes) drop(id, pane);
    },
    watchedPanes: () => [...panes.keys()],
  };
}

export type ConversationWatcher = ReturnType<typeof createConversationWatcher>;
