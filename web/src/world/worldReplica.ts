/**
 * The browser's replica of World's publication (openspec world-one-object,
 * task 4.4): commands in progress and the settings World publishes with
 * topology, and the pending values a browser holds so a change it made, or
 * one World reports in progress, never flashes back to the old value. Every
 * view reads the same replica (runtimeStore.ts).
 */

import type { WorldRuntimeConnection } from "./runtimeStore";

type WorldCommandEntity = {
  kind: "room";
  connection_id: string;
  generation: number;
  room_id: string;
};

type WorldCommandState =
  | "accepted"
  | "sent"
  | "stored"
  | "observed"
  | "refused"
  | "failed"
  | "uncertain";

export type WorldCommand = {
  id: string;
  entity: WorldCommandEntity;
  field: "name";
  expected: string;
  value: string;
  state: WorldCommandState;
  observed?: string | null;
  detail?: string;
};

export type WorldUiSettings = {
  ui: Record<string, unknown>;
  /** The settings' own commit order (bridge.ui_settings.*). */
  revision: number;
};

const IN_PROGRESS = new Set<WorldCommandState>(["accepted", "sent"]);
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function inProgress(command: WorldCommand) {
  return IN_PROGRESS.has(command.state);
}

/** Commands as World published them; malformed entries are skipped. */
export function parseWorldCommands(value: unknown): WorldCommand[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).flatMap((item): WorldCommand[] => {
    const command = record(item);
    const entity = record(command?.entity);
    if (
      !command ||
      !entity ||
      typeof command.id !== "string" ||
      entity.kind !== "room" ||
      typeof entity.connection_id !== "string" ||
      !Number.isSafeInteger(entity.generation) ||
      typeof entity.room_id !== "string" ||
      command.field !== "name" ||
      typeof command.expected !== "string" ||
      typeof command.value !== "string" ||
      typeof command.state !== "string"
    )
      return [];
    return [
      {
        id: command.id,
        entity: {
          kind: "room",
          connection_id: entity.connection_id,
          generation: entity.generation as number,
          room_id: entity.room_id,
        },
        field: "name",
        expected: command.expected,
        value: command.value,
        state: command.state as WorldCommandState,
        ...(typeof command.observed === "string" || command.observed === null
          ? { observed: command.observed as string | null }
          : {}),
        ...(typeof command.detail === "string"
          ? { detail: command.detail }
          : {}),
      },
    ];
  });
}

export function parseWorldUiSettings(value: unknown): WorldUiSettings | null {
  const settings = record(value);
  const ui = record(settings?.ui);
  if (!settings || !ui || !Number.isSafeInteger(settings.revision)) return null;
  return { ui, revision: settings.revision as number };
}

/** The room key a pending value applies to. */
const entityKey = (entity: WorldCommandEntity) =>
  JSON.stringify([entity.connection_id, entity.generation, entity.room_id]);

/**
 * Pending room names: this browser's own commands until World publishes
 * their outcome, and every command World publishes as in progress.
 */
export function pendingNames(
  local: Iterable<WorldCommand>,
  published: readonly WorldCommand[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const command of published)
    if (inProgress(command))
      names.set(entityKey(command.entity), command.value);
  for (const command of local)
    names.set(entityKey(command.entity), command.value);
  return names;
}

const presented = new WeakMap<
  WorldRuntimeConnection,
  { key: string; connection: WorldRuntimeConnection }
>();

/**
 * Connections with pending names shown in place of published ones. The same
 * published connection and pending names give the same object, so prepared
 * World objects are reused.
 */
export function presentPending(
  connections: WorldRuntimeConnection[],
  names: ReadonlyMap<string, string>,
): WorldRuntimeConnection[] {
  if (names.size === 0) return connections;
  return connections.map((connection) => {
    const snapshot = connection.snapshot;
    if (!snapshot) return connection;
    const renames = snapshot.workspaces.flatMap((workspace) => {
      const name = names.get(
        JSON.stringify([
          connection.connectionId,
          connection.generation,
          workspace.workspace_id,
        ]),
      );
      return name !== undefined && name !== workspace.label
        ? [[workspace.workspace_id, name] as const]
        : [];
    });
    if (renames.length === 0) return connection;
    const key = JSON.stringify(renames);
    const held = presented.get(connection);
    if (held?.key === key) return held.connection;
    const byId = new Map(renames);
    const next: WorldRuntimeConnection = {
      ...connection,
      snapshot: {
        ...snapshot,
        workspaces: snapshot.workspaces.map((workspace) =>
          byId.has(workspace.workspace_id)
            ? { ...workspace, label: byId.get(workspace.workspace_id)! }
            : workspace,
        ),
      },
    };
    presented.set(connection, { key, connection: next });
    return next;
  });
}
