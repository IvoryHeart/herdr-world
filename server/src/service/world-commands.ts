import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { CoreOperationRefused, renameCoreRoom } from "../herdr-core/operations";
import type { CoreRpcServices } from "../rpc/core";
import type { ObservedSnapshots } from "../rpc/context";
import {
  WorldCommandRefused,
  WorldCommands,
  type PublishedCommand,
  type WorldCommandInput,
} from "../world/commands";
import type { LedgerStore } from "../world/world-ledger";

const RECONNECTED = "The host reconnected; look again and retry.";

/**
 * World commands composed over the service: the entity's own connection and
 * generation for sending, the snapshot service's epoch fence for settling,
 * and the World ledger for history.
 */
export function composeWorldCommands(deps: {
  now(): number;
  connectionManager: ConnectionManager<LegacyConnectionRuntime>;
  core: () => CoreRpcServices | undefined;
  snapshots: ObservedSnapshots;
  ledger: () => LedgerStore;
  /** Advance the host's epoch and tell every browser (world_invalidated). */
  invalidate(connectionId: string, generation: number): void;
  /** Publish World's own values under a new revision to every browser. */
  publish(): void;
  log(message: string): void;
}) {
  const herdr = (id: string) => deps.connectionManager.has(id);
  const core = (id: string) => deps.core()?.manager.has(id) === true;
  const commands = new WorldCommands({
    now: deps.now,
    runtime: (id) => (herdr(id) ? "herdr" : core(id) ? "herdr-core" : null),
    rooms: (id, generation) => deps.snapshots.rooms(id, generation),
    async send(command: WorldCommandInput) {
      const { connection_id: id, generation, room_id } = command.entity;
      if (herdr(id)) {
        const lease = deps.connectionManager.readyRuntimeLease(id);
        if (!lease || lease.generation !== generation || !lease.isCurrent())
          throw new WorldCommandRefused(RECONNECTED);
        await lease.runtime.tui.call(
          "workspace.rename",
          { workspace_id: room_id, label: command.value },
          10_000,
        );
        return;
      }
      const services = deps.core();
      if (!services || !core(id)) throw new WorldCommandRefused(RECONNECTED);
      const lease = services.manager.readyRuntimeLease(id);
      if (!lease || lease.generation !== generation || !lease.isCurrent())
        throw new WorldCommandRefused(RECONNECTED);
      try {
        // World's own store: the commit is the change; the read that follows
        // publishes it with the outcome.
        await renameCoreRoom(lease, services.topology, room_id, command.value);
      } catch (error) {
        if (error instanceof CoreOperationRefused)
          throw new WorldCommandRefused(error.message);
        throw error;
      }
    },
    acknowledged(id, generation) {
      deps.invalidate(id, generation);
      const epoch = deps.snapshots.epoch(id);
      // Read again now, so the outcome does not wait for a browser to ask.
      void deps.snapshots
        .snapshot({ priority_connection_ids: [id] })
        .catch((error) => deps.log(`World command read failed: ${error}`));
      return epoch;
    },
    publish: deps.publish,
    record(command: PublishedCommand) {
      void recordRoomRename(deps.ledger(), command).catch((error) =>
        deps.log(`World command history not recorded: ${error}`),
      );
    },
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  deps.snapshots.onAdmittedRead((read) => commands.admittedRead(read));
  return commands;
}

/** One settled rename in the ledger's existing change history. */
async function recordRoomRename(
  ledger: LedgerStore,
  command: PublishedCommand,
) {
  const id = await ledger.nextId("c");
  await ledger.update((document) => {
    document.changes.push({
      id,
      at: command.at,
      actor: { label: "World", verified: false },
      command: "room rename",
      summary: `Renamed room “${command.expected}” to “${command.value}”`,
      undo: null,
    });
  });
}
