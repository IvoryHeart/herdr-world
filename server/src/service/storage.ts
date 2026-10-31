import type { ProfileStorePort } from "../agent/profile-store";
import type { DataPaths } from "../config/data-paths";
import {
  createGuiSettingsStore,
  type GuiSettingsStore,
} from "../config/gui-settings";
import { ConnectionProfileStore } from "../connections/profiles";
import type { BoardStore } from "../world/board-store";
import { BindingBoardStore } from "../storage/binding-board-store";
import type { LedgerStore } from "../world/world-ledger";
import { openWorldLedger } from "../storage/world-storage";
import type { AttentionOutbox } from "../storage/world-protocol";
import { join } from "node:path";
import type { Clock, Scheduler } from "./ports";

/**
 * World-owned state, by family. Secrets, the instance lock and Ranger's
 * folder stay plain files under DataPaths, outside this port.
 */
export type WorldStorage = {
  runtimeStatus: import("../storage/runtime-status").RuntimeStatusPort;
  bindings: import("../storage/world-bindings").WorldBindings;
  ids: import("../storage/world-ids").WorldIds;
  settings: GuiSettingsStore;
  connections: ConnectionProfileStore;
  /** Opened on first use. */
  board(): BoardStore;
  /** Committed reads; SQLite is opened before the listener can bind. */
  ledger(): LedgerStore;
  attention(): AttentionOutbox;
  failed?: Promise<Error>;
  incarnation?: string;
  /** Committed profile cache; SQLite import finishes before the listener binds. */
  profiles(): ProfileStorePort;
  /**
   * Called last in stop: every family refuses later writes, unopened lazy
   * families stay closed, and queued writes settle.
   */
  close(): Promise<void>;
};

export type OpenStorage = (
  paths: DataPaths,
  ports: { clock: Clock; scheduler: Scheduler },
) => Promise<WorldStorage>;

/** Private JSON configuration/Board and worker-owned SQLite domain families. */
export const openStorage: OpenStorage = async (paths, { clock, scheduler }) => {
  const options = {
    now: () => clock.now(),
    log: (message: string) => console.warn(message),
  };
  const connections = new ConnectionProfileStore({ path: paths.connections });
  let board: BindingBoardStore | null = null;
  const bindingFailure = Promise.withResolvers<Error>();
  const world = await openWorldLedger(
    {
      database: join(paths.root, "world.sqlite"),
      ledger: paths.ledger,
      profiles: paths.agentProfiles,
      settings: paths.settings,
    },
    { clock, scheduler },
  );
  const settings = createGuiSettingsStore(paths.settings, {
    runtimeStatusMigrated: true,
  });
  let profiles: ProfileStorePort | null = null;
  let closed = false;
  // Even construction can rename an unreadable JSON file: fence before it.
  const open = <T>(store: T | null, create: () => T): T => {
    if (store) return store;
    if (closed) throw new Error("World storage is closed");
    return create();
  };
  return {
    runtimeStatus: world.runtimeStatus,
    ids: world.ids,
    bindings: world.bindings,
    settings,
    connections,
    board: () =>
      (board = open(board, () => {
        const store = new BindingBoardStore(
          paths.board,
          options,
          world.bindings,
        );
        void store.failed.then(bindingFailure.resolve);
        return store;
      })),
    // Eager committed cache only: this accessor never opens/imports/migrates.
    ledger: () => world.ledger,
    attention: () => world.outbox,
    failed: Promise.race([world.failed, bindingFailure.promise]),
    incarnation: world.incarnation,
    profiles: () => (profiles = open(profiles, () => world.profiles)),
    async close() {
      closed = true;
      board?.close();
      profiles?.close();
      // Fence every family now, including a write from a late request body.
      const worldClosing = world.close();
      try {
        await Promise.all([settings.close(), connections.close()]);
      } finally {
        await worldClosing;
      }
    },
  };
};
