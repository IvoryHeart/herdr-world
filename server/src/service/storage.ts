import { ProfileStore } from "../agent/profile-store";
import type { DataPaths } from "../config/data-paths";
import {
  createGuiSettingsStore,
  type GuiSettingsStore,
} from "../config/gui-settings";
import { ConnectionProfileStore } from "../connections/profiles";
import { BoardStore } from "../world/board-store";
import type { LedgerStore } from "../world/world-ledger";
import { openWorldLedger } from "../storage/world-storage";
import type { AttentionOutbox } from "../storage/world-protocol";
import type { EffectStore } from "../effects/types";
import { join } from "node:path";
import type { Clock, Scheduler } from "./ports";

/**
 * World-owned state, by family. Secrets, the instance lock and Ranger's
 * folder stay plain files under DataPaths, outside this port.
 */
export type WorldStorage = {
  ids: import("../storage/world-ids").WorldIds;
  settings: GuiSettingsStore;
  connections: ConnectionProfileStore;
  /** Opened on first use. */
  board(): BoardStore;
  /** Committed reads; SQLite is opened before the listener can bind. */
  ledger(): LedgerStore;
  attention(): AttentionOutbox;
  effects(): EffectStore;
  failed?: Promise<Error>;
  incarnation?: string;
  /** Opened on first use. */
  profiles(): ProfileStore;
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

/** Private JSON configuration/Board/profiles and the worker-owned SQLite ledger. */
export const openStorage: OpenStorage = async (paths, { clock, scheduler }) => {
  const options = {
    now: () => clock.now(),
    log: (message: string) => console.warn(message),
  };
  const settings = createGuiSettingsStore(paths.settings);
  const connections = new ConnectionProfileStore({ path: paths.connections });
  let board: BoardStore | null = null;
  const world = await openWorldLedger(
    { database: join(paths.root, "world.sqlite"), ledger: paths.ledger },
    { clock, scheduler },
  );
  let profiles: ProfileStore | null = null;
  let closed = false;
  // Even construction can rename an unreadable JSON file: fence before it.
  const open = <T>(store: T | null, create: () => T): T => {
    if (store) return store;
    if (closed) throw new Error("World storage is closed");
    return create();
  };
  return {
    ids: world.ids,
    settings,
    connections,
    board: () =>
      (board = open(board, () => new BoardStore(paths.board, options))),
    // Eager committed cache only: this accessor never opens/imports/migrates.
    ledger: () => world.ledger,
    attention: () => world.outbox,
    effects: () => world.effects,
    failed: world.failed,
    incarnation: world.incarnation,
    profiles: () =>
      (profiles = open(
        profiles,
        () => new ProfileStore(paths.agentProfiles, options),
      )),
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
