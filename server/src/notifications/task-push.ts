import type { TaskEvent } from "./task-events";
import type { PushTask } from "./web-push";

/**
 * A task event as World pushes it: qualified by the runtime connection and
 * generation it came from, and named after that connection when there is
 * more than one, so a push says which host it is about. Herdr (TUI) and
 * herdr-core events take the same path.
 */
export function connectionTaskPush(
  event: TaskEvent,
  connectionId: string,
  generation: number,
  connections: readonly { id: string; label: string }[],
  fallbackLabel?: string,
): PushTask {
  return {
    ...event,
    connectionId,
    connectionLabel:
      connections.length > 1
        ? (connections.find((connection) => connection.id === connectionId)
            ?.label ?? fallbackLabel)
        : undefined,
    runtimeGeneration: generation,
  };
}
