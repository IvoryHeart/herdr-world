import type { WorldLeafObject, WorldObject } from "./worldObject";

/**
 * The herdr-core terminal Spaces shows (#1329): which World node, on which
 * runtime generation. Only a presentation choice; the terminal itself is read
 * from the World object every render.
 */
export type SpacesCoreChoice = {
  nodeId: string;
  connectionId: string;
  generation: number;
  /** The name to show if World stops seeing it. */
  label: string;
};

export function spacesCoreChoice(leaf: WorldLeafObject): SpacesCoreChoice {
  return {
    nodeId: leaf.id,
    connectionId: leaf.connectionId,
    generation: leaf.generation,
    label: leaf.label,
  };
}

/**
 * The chosen terminal as World sees it now, or undefined once it is gone,
 * stale or on another runtime generation: Spaces never follows it to a new
 * generation or another connection.
 */
export function spacesCoreLeaf(
  world: Pick<WorldObject, "nodeById">,
  choice: SpacesCoreChoice,
): WorldLeafObject | undefined {
  const node = world.nodeById.get(choice.nodeId);
  if (node?.kind !== "agent" && node?.kind !== "terminal") return;
  if (
    node.connectionId !== choice.connectionId ||
    node.generation !== choice.generation ||
    node.watch?.generation !== choice.generation ||
    node.stale
  )
    return;
  return node;
}
