import { WorldDeskRegistry } from "./desk-state";
import { observeDeskPanes } from "./desk-observation";

/** Wires one process-local registry to its fresh producer and browser notices. */
export function createWorldDeskService(broadcast: (line: string) => void) {
  const registry = new WorldDeskRegistry();
  const publish = (revision: number) =>
    broadcast(
      JSON.stringify({ control: { type: "world_desk_changed", revision } }),
    );
  const changed = (mutate: () => void) => {
    const revision = registry.list().revision;
    mutate();
    const next = registry.list().revision;
    if (next !== revision) publish(next);
  };
  return {
    registry,
    publish,
    retire: (connectionId: string, generation: number) =>
      changed(() =>
        registry.retireConnectionGeneration(connectionId, generation),
      ),
    observe: (
      connectionId: string,
      generation: number,
      panes: readonly Record<string, unknown>[],
      at: number,
    ) =>
      changed(() =>
        observeDeskPanes(registry, connectionId, generation, panes, at),
      ),
  };
}
