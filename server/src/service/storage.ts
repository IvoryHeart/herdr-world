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
  /** Called last in stop, once nothing can write any more. */
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
  let board: BoardStore | null = null;
  let ledger: WorldLedger | null = null;
  let profiles: ProfileStore | null = null;
  return {
    settings,
    connections: new ConnectionProfileStore({ path: paths.connections }),
    board: () => (board ??= new BoardStore(paths.board, options)),
    ledger: () => (ledger ??= new WorldLedger(paths.ledger, options)),
    profiles: () =>
      (profiles ??= new ProfileStore(paths.agentProfiles, options)),
    close: () => settings.flush(),
  };
};
