import { ProfileStore } from "../agent/profile-store";
import type { DataPaths } from "../config/data-paths";
import {
  createGuiSettingsStore,
  type GuiSettingsStore,
} from "../config/gui-settings";
import { ConnectionProfileStore } from "../connections/profiles";
import { BoardStore } from "../world/board-store";
import { WorldLedger } from "../world/world-ledger";
import type { Clock, Scheduler } from "./ports";

/**
 * World-owned state, by family. Secrets, the instance lock and Ranger's
 * folder stay plain files under DataPaths, outside this port.
 */
export type WorldStorage = {
  settings: GuiSettingsStore;
  connections: ConnectionProfileStore;
  /** Opened on first use. */
  board(): BoardStore;
  /** Opened on first use. */
  ledger(): WorldLedger;
  /** Opened on first use. */
  profiles(): ProfileStore;
  /**
   * Called last in stop: every family refuses later writes, a family never
   * opened can no longer open, and queued writes settle.
   */
  close(): Promise<void>;
};

export type OpenStorage = (
  paths: DataPaths,
  ports: { clock: Clock; scheduler: Scheduler },
) => Promise<WorldStorage>;

/** Today's JSON files, each rewritten whole on change. */
export const openStorage: OpenStorage = async (paths, { clock }) => {
  const options = {
    now: () => clock.now(),
    log: (message: string) => console.warn(message),
  };
  const settings = createGuiSettingsStore(paths.settings);
  const connections = new ConnectionProfileStore({ path: paths.connections });
  let board: BoardStore | null = null;
  let ledger: WorldLedger | null = null;
  let profiles: ProfileStore | null = null;
  let closed = false;
  // Opening a family may set an unreadable file aside, which is a write, so
  // a family not yet open stays closed for good once storage closes.
  const open = <T>(store: T | null, create: () => T): T => {
    if (store) return store;
    if (closed) throw new Error("World storage is closed");
    return create();
  };
  return {
    settings,
    connections,
    board: () =>
      (board = open(board, () => new BoardStore(paths.board, options))),
    ledger: () =>
      (ledger = open(ledger, () => new WorldLedger(paths.ledger, options))),
    profiles: () =>
      (profiles = open(
        profiles,
        () => new ProfileStore(paths.agentProfiles, options),
      )),
    // Every store refuses writes from here on, even from work that outlived
    // the drain; a later owner of the folder opens stores of its own.
    async close() {
      closed = true;
      board?.close();
      ledger?.close();
      profiles?.close();
      await Promise.all([settings.close(), connections.close()]);
    },
  };
};
