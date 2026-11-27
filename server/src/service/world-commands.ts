import { createUiSettingsRpcHandler } from "../bridge/settings-rpc";
import type { GuiSettingsStore } from "../config/gui-settings";
import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { CoreOperationRefused, renameCoreRoom } from "../herdr-core/operations";
import type { CoreRpcServices } from "../rpc/core";
import type { ObservedSnapshots } from "../rpc/context";
import {
  commandSettled,
  WorldCommandRefused,
  WorldCommands,
  type PublishedCommand,
  type WorldCommandInput,
} from "../world/commands";
import type { LedgerChange, LedgerStore } from "../world/world-ledger";

const RECONNECTED = "The host reconnected; look again and retry.";

/**
 * One publication for World's own values: settings and commands are read
 * after each topology revision is taken and published under it, and a change
 * to either advances that revision with one notice to every browser.
 */
export function composeWorldPublication(
  deps: Omit<Parameters<typeof composeWorldCommands>[0], "publish"> & {
    settings: Pick<GuiSettingsStore, "read" | "update">;
    broadcast(line: string, context: string): void;
  },
) {
  const uiSettings = createUiSettingsRpcHandler({
    readSettings: () => deps.settings.read(),
    updateSettings: (update, shouldCommit) =>
      deps.settings.update(update, shouldCommit),
  });
  /** World's own values changed: one revision, one notice to every browser. */
  const publishWorld = () => {
    const revision = deps.snapshots.publish();
    deps.broadcast(
      JSON.stringify({ control: { type: "world_invalidated", revision } }),
      "world-invalidation",
    );
  };
  const worldCommands = composeWorldCommands({
    ...deps,
    publish: publishWorld,
  });
  // Settings and commands are published with topology, under its revision.
  deps.snapshots.publishWith(async () => ({
    ui_settings: await uiSettings("bridge.ui_settings.get", {}),
    commands: worldCommands.published(),
  }));
  return { uiSettings, publishWorld, worldCommands };
}

/**
 * World commands composed over the service: the entity's own connection and
 * generation for sending, the snapshot service's epoch fence for settling,
 * and the World ledger's change history as the durable record of each
 * accepted command and its outcome (no new table or file).
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
  let records: Promise<void> = Promise.resolve();
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
      // One record per command, written in order: acceptance, then outcome.
      const write = records.then(() =>
        recordRoomRename(deps.ledger(), command),
      );
      records = write.catch(() => undefined);
      return write.catch((error) => {
        deps.log(`World command history not recorded: ${error}`);
        throw error;
      });
    },
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  deps.snapshots.onAdmittedRead((read) => commands.admittedRead(read));
  try {
    // Commands accepted before a restart that never settled.
    commands.recover(
      deps
        .ledger()
        .get()
        .changes.flatMap((change) =>
          change.world_command && !commandSettled(change.world_command)
            ? [change.world_command]
            : [],
        ),
    );
  } catch (error) {
    deps.log(`World commands not recovered: ${error}`);
  }
  return commands;
}

const recordOf = (changes: readonly LedgerChange[], commandId: string) =>
  changes.findLast((change) => change.world_command?.id === commandId);

function summary(command: PublishedCommand) {
  const { expected, value, observed, detail } = command;
  const reason = detail ? `: ${detail}` : "";
  switch (command.state) {
    case "accepted":
    case "sent":
      return `Renaming room “${expected}” to “${value}”`;
    case "observed":
    case "stored":
      return observed === value
        ? `Renamed room “${expected}” to “${value}”`
        : `Room rename to “${value}” did not hold${reason}`;
    case "refused":
      return `Room rename to “${value}” refused${reason}`;
    case "failed":
      return `Room rename to “${value}” failed${reason}`;
    case "uncertain":
      return `Room rename to “${value}” uncertain${reason}`;
  }
}

/**
 * The command's record in the ledger's existing change history, created at
 * acceptance and replaced in place as its state changes.
 */
async function recordRoomRename(
  ledger: LedgerStore,
  command: PublishedCommand,
) {
  const existing = recordOf(ledger.get().changes, command.id);
  const id = existing?.id ?? (await ledger.nextId("c"));
  await ledger.update((document) => {
    const record: LedgerChange = {
      id,
      at: existing?.at ?? command.at,
      actor: { label: "World", verified: false },
      command: "room rename",
      summary: summary(command),
      undo: null,
      world_command: command,
    };
    const index = document.changes.findIndex((change) => change.id === id);
    if (index >= 0) document.changes[index] = record;
    else document.changes.push(record);
  });
}
