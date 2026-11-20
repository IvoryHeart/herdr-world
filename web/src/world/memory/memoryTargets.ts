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
    .filter((host) => !host.stale && (host.actionable || host.coreControl))
    .map((host) => {
      const names: Record<string, string> = {};
      for (const leaf of world.leaves)
        if (leaf.connectionId === host.connectionId)
          names[leaf.pane.pane_id ?? leaf.terminalId] = agentName(leaf);
      return {
        connection_id: host.connectionId,
        connection_generation: host.connection.generation,
        label: host.label,
        names,
      };
    });
}

/** Keep the Library's host list current with World's (WorldControlPlane). */
export function useMemoryHostPublisher(world: WorldObject) {
  useEffect(() => {
    publishMemoryHosts(memoryHostsOf(world));
  }, [world]);
}
