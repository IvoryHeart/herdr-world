import { memoryHarness } from "../../../../shared/memory";
import { memoryFixtureOn, memoryFixtureHasMemory } from "./memoryFixture";
import type { MemoryLibraryRequest } from "./memoryEvents";
import { useEffect } from "react";
import { agentName } from "../deskAgentLabels";
import type { WorldObject } from "../worldObject";
import { publishMemoryHosts, type MemoryHostTarget } from "./memoryClient";

/**
 * The hosts the Library (#1027) may read: live connections World observes
 * now, each with its current generation, never a stale or cached one. The
 * names are World's for each pane, so a catalog's agent IDs read as people
 * know them. Agent IDs are pane IDs, as the memory service's are.
 */
export function memoryHostsOf(world: WorldObject): MemoryHostTarget[] {
  return world.hosts
    .filter(
      (host) =>
        !host.stale &&
        (host.actionable || host.coreControl) &&
        worldHasMemory(world, { connectionId: host.connectionId }),
    )
    .map((host) => {
      const names: Record<string, string> = {};
      const rooms: Record<string, string> = {};
      for (const leaf of world.leaves)
        if (leaf.connectionId === host.connectionId) {
          names[leaf.pane.pane_id ?? leaf.terminalId] = agentName(leaf);
          rooms[leaf.workspaceId] = leaf.spaceLabel;
        }
      return {
        connection_id: host.connectionId,
        connection_generation: host.connection.generation,
        label: host.label,
        names,
        rooms,
      };
    });
}

/** Keep the Library's host list current with World's (WorldControlPlane). */
export function useMemoryHostPublisher(world: WorldObject) {
  useEffect(() => {
    publishMemoryHosts(memoryHostsOf(world));
  }, [world]);
}

/** Capability follows current readers, including supported readers with no files yet. */
export function worldHasMemory(
  world: Pick<WorldObject, "leaves">,
  request: MemoryLibraryRequest = {},
): boolean {
  return world.leaves.some(
    (leaf) =>
      leaf.kind === "agent" &&
      !leaf.stale &&
      (leaf.actionable || leaf.coreControl) &&
      memoryHarness(leaf.pane?.agent) !== null &&
      (!request.connectionId || leaf.connectionId === request.connectionId) &&
      (!request.workspaceId || leaf.workspaceId === request.workspaceId) &&
      (!request.agentId ||
        (leaf.pane.pane_id ?? leaf.terminalId) === request.agentId),
  );
}

export function libraryAvailable(
  world: Pick<WorldObject, "leaves">,
  request: MemoryLibraryRequest = {},
) {
  return memoryFixtureOn()
    ? memoryFixtureHasMemory()
    : worldHasMemory(world, request);
}
