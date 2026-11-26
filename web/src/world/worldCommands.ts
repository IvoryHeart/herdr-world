/**
 * World commands from the browser (openspec world-one-object, task 4.1):
 * every view asks World for a change through world.command, naming the
 * entity on its own connection and generation and the value it saw. The
 * shared replica holds the pending value until World publishes the outcome.
 */

import {
  RUNTIME_GROUPING_DEFAULT,
  RUNTIME_GROUPING_SETTING_KEY,
  type RuntimeGrouping,
} from "../../../shared/hostGrouping";
import { bridge } from "../api";
import { store } from "../store";
import { provideRuntimeGroupingControl } from "./runtimeGrouping";
import { worldRuntimeStore } from "./runtimeStore";
import {
  inProgress,
  parseWorldCommands,
  type WorldCommand,
} from "./worldReplica";

/** A room on its own connection and the generation it was observed in. */
export type WorldCommandRoom = {
  connectionId: string;
  generation: number;
  workspaceId: string;
};

const newId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const failure = (detail: string) =>
  store.notify({ kind: "error", message: "Room rename failed", detail });

/** Tell the person when World did not make the change they asked for. */
function reportOutcome(outcome: WorldCommand | null) {
  if (!outcome) {
    failure("World restarted before it saw the result; look again.");
    return;
  }
  if (inProgress(outcome)) return;
  if (outcome.state === "refused" || outcome.state === "failed")
    failure(outcome.detail ?? "World did not rename the room.");
  else if (outcome.state === "uncertain")
    failure(
      outcome.detail ?? "World could not tell whether the room was renamed.",
    );
  else if (outcome.observed !== outcome.value)
    failure(outcome.detail ?? "The room shows another name.");
}

/**
 * Rename a room through World. `expected` is the name the person saw; World
 * refuses if the room's name changed since.
 */
export async function renameRoomThroughWorld(
  room: WorldCommandRoom,
  expected: string,
  value: string,
) {
  const command: WorldCommand = {
    id: newId(),
    entity: {
      kind: "room",
      connection_id: room.connectionId,
      generation: room.generation,
      room_id: room.workspaceId,
    },
    field: "name",
    expected,
    value,
    state: "accepted",
  };
  const held = worldRuntimeStore.holdPending(command, reportOutcome);
  let reply: unknown;
  try {
    reply = await bridge.call(
      "world.command",
      {
        id: command.id,
        entity: command.entity,
        field: command.field,
        expected,
        value,
      },
      30_000,
    );
  } catch (cause) {
    held.release();
    failure(cause instanceof Error ? cause.message : String(cause));
    return;
  }
  const [answer] = parseWorldCommands([reply]);
  if (!answer || !inProgress(answer)) {
    // Refused before anything changed: show the observed name again.
    held.release();
    reportOutcome(answer ?? null);
    return;
  }
  held.answered();
}

/**
 * Change World's "Group runtimes" setting. A choice only sets a value, so
 * World accepts it even if another browser changed the setting since
 * `expected` was shown, records both in its change history and publishes
 * the result; every view follows the publication. Nothing is held here.
 */
async function setRuntimeGroupingThroughWorld(
  expected: RuntimeGrouping | null,
  value: RuntimeGrouping,
) {
  const failed = (detail: string) =>
    store.notify({
      kind: "error",
      message: "Group runtimes was not changed",
      detail,
    });
  try {
    const reply = (await bridge.call(
      "world.command",
      {
        id: newId(),
        entity: { kind: "setting", key: RUNTIME_GROUPING_SETTING_KEY },
        field: "value",
        expected,
        value,
      },
      30_000,
    )) as { state?: unknown; detail?: unknown } | null;
    if (reply?.state !== "stored")
      failed(
        typeof reply?.detail === "string"
          ? reply.detail
          : "World did not store the setting.",
      );
  } catch (cause) {
    failed(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Give the Settings control World's published grouping and its command. */
export function installRuntimeGroupingControl() {
  const published = () => worldRuntimeStore.get().hostGrouping?.grouping;
  provideRuntimeGroupingControl({
    get: () => published() ?? RUNTIME_GROUPING_DEFAULT,
    subscribe: (listener) => {
      const off = worldRuntimeStore.subscribe(listener);
      return () => void off();
    },
    set: (value) =>
      void setRuntimeGroupingThroughWorld(published() ?? null, value),
  });
}
