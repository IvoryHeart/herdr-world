import { memoryHarness } from "../../../../shared/memory";
import { memoryFixtureOn } from "./memoryFixture";
import type { MemoryLibraryRequest } from "./memoryEvents";
import { useEffect, useMemo } from "react";
import { agentName } from "../deskAgentLabels";
import type { WorldObject } from "../worldObject";
import {
  hostHasMemory,
  hostMade,
  libraryHosts,
  memoryHosts,
  memoryTargetKey,
  publishMemoryHosts,
  type MemoryHostTarget,
} from "./memoryClient";
import { requestArtefactShelf } from "./artefactShelfClient";

/** Shelves of memory-less hosts read at once; the rest wait their turn. */
const SHELF_READS = 4;

/**
 * The hosts the Library (#1027) may read: live connections World observes
 * now, each with its current generation, never a stale or cached one. The
 * names are World's for each pane, so a catalog's agent IDs read as people
 * know them. Agent IDs are pane IDs, as the memory service's are. A host
 * with no agent whose harness keeps memory is marked `memory: false`: only
 * what agents made there is read (#1342), so a host whose agents have all
 * stopped still shows their work.
 */
export function memoryHostsOf(world: WorldObject): MemoryHostTarget[] {
  return world.hosts
    .filter((host) => !host.stale && (host.actionable || host.coreControl))
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
        ...(worldHasMemory(world, { connectionId: host.connectionId })
          ? {}
          : { memory: false }),
      };
    });
}

/**
 * Keep the Library's host list current with World's (WorldControlPlane),
 * and read the "Made by agents" shelf of every host without memory, again
 * as one loses its last memory agent, so every view knows whether the
 * Library has something there (#1342). Only a few are read at once.
 */
export function useMemoryHostPublisher(world: WorldObject) {
  const published = useMemo(() => memoryHostsOf(world), [world]);
  useEffect(() => {
    publishMemoryHosts(published);
  }, [published]);
  // The testing switch's synthetic host stands in for World's.
  const bare = (memoryFixtureOn() ? memoryHosts() : published).filter(
    (host) => !hostHasMemory(host),
  );
  const bareKeys = bare.map(memoryTargetKey).join("\n");
  useEffect(() => {
    let stopped = false;
    void readInTurn(bare, requestArtefactShelf, () => stopped);
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bareKeys]);
}

/**
 * Read every host's shelf, at most `limit` at a time, in order; once
 * `stopped` says so (the host list changed) no further read starts.
 */
async function readInTurn<T>(
  hosts: readonly T[],
  read: (host: T) => Promise<unknown>,
  stopped: () => boolean,
  limit = SHELF_READS,
) {
  let next = 0;
  const reader = async () => {
    while (next < hosts.length && !stopped()) {
      const host = hosts[next++] as T;
      await read(host).catch(() => undefined);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, hosts.length) }, reader),
  );
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

/**
 * Whether the Library opens on `request`: an agent with memory matches it,
 * or its host (any, when none is named) has things agents made on its shelf,
 * even with every agent gone (#1342).
 */
export function libraryAvailable(
  world: Pick<WorldObject, "leaves">,
  request: MemoryLibraryRequest = {},
) {
  if (memoryFixtureOn()) return libraryHosts().length > 0;
  return (
    worldHasMemory(world, request) ||
    libraryHosts().some(
      (host) =>
        hostMade(host) > 0 &&
        (!request.connectionId || host.connection_id === request.connectionId),
    )
  );
}
