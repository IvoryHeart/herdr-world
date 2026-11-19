// World's own layout of a core (M1): the document shape and its limits.
// Storage keeps it (storage/core-topology.ts); the read model and the
// operations only need these types, so they never depend on storage.

/**
 * World's own layout of one herdr-core (M1): rooms, their order, and the
 * tabs World started terminals in. World owns it; core and Herdr's apps
 * never see it, and World never reads or writes the app's layout document.
 * A terminal is named by its address, which core never reuses, under the
 * durable `core.id`; a different core is a different document.
 *
 * A room with `app_space` stands for a Herdr app space World saw by its
 * labels: terminals World starts there are kept with it, but its name and
 * existence stay the app's.
 */
export type CoreTopologyTab = {
  id: string;
  /** The name it was started with (the launch's label). */
  label: string;
  terminals: string[];
};
/**
 * A linked Git worktree World created or opened as a room (P4): the
 * checkout is the room's folder, so its Files, hooks and new terminals use
 * it. `source` is the repository it was made from.
 */
export type CoreRoomCheckout = {
  path: string;
  source: string;
  branch?: string;
};
export type CoreTopologyRoom = {
  id: string;
  label: string;
  app_space?: string;
  checkout?: CoreRoomCheckout;
  tabs: CoreTopologyTab[];
};
export type CoreTopologyDocument = {
  core_id: string;
  revision: number;
  rooms: CoreTopologyRoom[];
};

export const CORE_TOPOLOGY_LIMITS = Object.freeze({
  rooms: 256,
  tabs: 4_096,
  terminals: 4_096,
  label: 100,
  bytes: 512 * 1024,
});

export type CoreTopologyPort = {
  get(coreId: string): CoreTopologyDocument;
  /**
   * Applies `change` to the latest committed document of `coreId`, one
   * change per core at a time. `change` returns null to write nothing.
   */
  update(
    coreId: string,
    change: (current: CoreTopologyDocument) => CoreTopologyDocument | null,
  ): Promise<CoreTopologyDocument>;
  close(): void;
};
