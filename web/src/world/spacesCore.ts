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

/** One tab of Spaces' herdr-core strip (#1390). */
type SpacesCoreStripTab = {
  choice: SpacesCoreChoice;
  /** The live terminal, absent for the open one once World stops seeing it. */
  leaf?: WorldLeafObject;
};

/** A room's tabs, in World's order: the rooms Town and Board show. */
export type SpacesCoreStripGroup = {
  id: string;
  label: string;
  tabs: SpacesCoreStripTab[];
};

/**
 * The strip Spaces shows over a herdr-core terminal (#1390): every live
 * terminal World watches on the chosen one's connection and runtime
 * generation, grouped by World's rooms in World's order. A terminal that
 * stops or goes stale leaves; the open one, once gone, stays as a last
 * group of its own (no leaf) so the strip still marks what is shown.
 * Nothing here follows a terminal to another generation or connection.
 */
export function spacesCoreStrip(
  world: Pick<WorldObject, "hosts" | "nodeById">,
  choice: SpacesCoreChoice,
): SpacesCoreStripGroup[] {
  const host = world.hosts.find(
    (candidate) => candidate.connectionId === choice.connectionId,
  );
  const groups: SpacesCoreStripGroup[] = [];
  let chosenLive = false;
  for (const space of host?.spaces ?? []) {
    const tabs: SpacesCoreStripTab[] = [];
    for (const leaf of space.children) {
      const tab = spacesCoreChoice(leaf);
      if (
        tab.generation !== choice.generation ||
        !leaf.coreControl ||
        !spacesCoreLeaf(world, tab)
      )
        continue;
      if (tab.nodeId === choice.nodeId) chosenLive = true;
      tabs.push({ choice: tab, leaf });
    }
    if (tabs.length) groups.push({ id: space.id, label: space.label, tabs });
  }
  if (!chosenLive)
    groups.push({ id: `gone:${choice.nodeId}`, label: "", tabs: [{ choice }] });
  return groups;
}

/**
 * The tab a tab key chooses from `current`, as the Herdr TUI strip's keys
 * choose (wrapping previous/next, numbers by position), or undefined.
 * Only live tabs are chosen.
 */
export function spacesCoreStripStep(
  groups: readonly SpacesCoreStripGroup[],
  current: string,
  step: "previous" | "next" | number,
): SpacesCoreChoice | undefined {
  const live = groups.flatMap((group) =>
    group.tabs.filter((tab) => tab.leaf).map((tab) => tab.choice),
  );
  if (!live.length) return;
  if (typeof step === "number") return live[step];
  const at = live.findIndex((tab) => tab.nodeId === current);
  if (at < 0) return step === "previous" ? live[live.length - 1] : live[0];
  const offset = step === "previous" ? -1 : 1;
  return live[(at + offset + live.length) % live.length];
}
