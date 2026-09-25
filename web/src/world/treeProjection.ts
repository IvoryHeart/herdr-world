import type {
  WorldAgentStatus,
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";

export const TREE_PRESENTATION_BOUNDS = Object.freeze({
  hosts: 128,
  spaces: 128,
  childrenPerSpace: 16,
});

export type WorldTreeSpace = {
  source: WorldSpaceObject;
  children: WorldLeafObject[];
  observedChildCount: number;
  omittedChildCount: number;
  watchedOmittedChildCount: number;
};

export type WorldTreeHost = {
  source: WorldHostObject;
  spaces: WorldTreeSpace[];
  observedSpaceCount: number;
  omittedSpaceCount: number;
};

export type WorldTreeProjection = {
  hosts: WorldTreeHost[];
  omittedHostCount: number;
  omittedSpaceCount: number;
  coverage: {
    observedLeaves: number;
    presentedLeaves: number;
    omittedLeaves: number;
    watchedOmittedLeaves: number;
  };
  presentationBounds: typeof TREE_PRESENTATION_BOUNDS;
};

type IndexedHost = { host: WorldHostObject; index: number };
type IndexedSpace = {
  host: WorldHostObject;
  space: WorldSpaceObject;
  hostIndex: number;
  index: number;
};

// This mirrors Graph's tested relevance policy while remaining in Tree's lazy
// chunk. Importing the Graph projection here creates another production asset.
export function projectWorldTree(
  world: WorldObject,
  selectedId: string | null = null,
): WorldTreeProjection {
  const selected = selectedPath(world, selectedId);
  const presentedHosts = world.hosts
    .map((host, index): IndexedHost => ({ host, index }))
    .sort((left, right) => compareHosts(left, right, selected.hostId))
    .slice(0, TREE_PRESENTATION_BOUNDS.hosts);
  const presentedHostIds = new Set(presentedHosts.map(({ host }) => host.id));
  const presentedSpaces = world.spaces
    .flatMap((space, index): IndexedSpace[] => {
      const hostIndex = world.hosts.findIndex(
        ({ id }) => id === space.parentId,
      );
      const host = hostIndex >= 0 ? world.hosts[hostIndex] : undefined;
      return host && presentedHostIds.has(host.id)
        ? [{ host, space, hostIndex, index }]
        : [];
    })
    .sort((left, right) => compareSpaces(left, right, selected.spaceId))
    .slice(0, TREE_PRESENTATION_BOUNDS.spaces);
  const spaceById = new Map(
    presentedSpaces.map(
      ({ space }) => [space.id, projectSpace(space, selected.leafId)] as const,
    ),
  );
  const hosts = presentedHosts.map(({ host }) => {
    const spaces = host.spaces.flatMap((space) => {
      const projected = spaceById.get(space.id);
      return projected ? [projected] : [];
    });
    return {
      source: host,
      spaces,
      observedSpaceCount: host.coverage.spaces,
      omittedSpaceCount: Math.max(0, host.coverage.spaces - spaces.length),
    } satisfies WorldTreeHost;
  });
  const presentedLeafCount = hosts.reduce(
    (total, host) =>
      total +
      host.spaces.reduce(
        (spaceTotal, space) => spaceTotal + space.children.length,
        0,
      ),
    0,
  );

  return {
    hosts,
    omittedHostCount: Math.max(0, world.hosts.length - hosts.length),
    omittedSpaceCount: Math.max(
      0,
      world.coverage.spaces - presentedSpaces.length,
    ),
    coverage: {
      observedLeaves: world.coverage.leaves,
      presentedLeaves: presentedLeafCount,
      omittedLeaves: Math.max(0, world.coverage.leaves - presentedLeafCount),
      watchedOmittedLeaves: hosts.reduce(
        (total, host) =>
          total +
          host.spaces.reduce(
            (spaceTotal, space) => spaceTotal + space.watchedOmittedChildCount,
            0,
          ),
        0,
      ),
    },
    presentationBounds: TREE_PRESENTATION_BOUNDS,
  };
}

function projectSpace(
  space: WorldSpaceObject,
  selectedLeafId: string | null,
): WorldTreeSpace {
  const children = space.children
    .map((leaf, index) => ({ leaf, index }))
    .sort((left, right) => compareLeaves(left, right, selectedLeafId))
    .slice(0, TREE_PRESENTATION_BOUNDS.childrenPerSpace)
    .map(({ leaf }) => leaf);
  return {
    source: space,
    children,
    observedChildCount: space.coverage.leaves,
    omittedChildCount: Math.max(0, space.coverage.leaves - children.length),
    watchedOmittedChildCount: Math.max(
      0,
      space.children.filter(({ watched }) => watched).length -
        children.filter(({ watched }) => watched).length,
    ),
  };
}

function compareHosts(
  left: IndexedHost,
  right: IndexedHost,
  selectedHostId: string | null,
) {
  return (
    Number(right.host.id === selectedHostId) -
      Number(left.host.id === selectedHostId) ||
    Number(right.host.selectedHost) - Number(left.host.selectedHost) ||
    Number(hostNeedsAttention(right.host)) -
      Number(hostNeedsAttention(left.host)) ||
    Number(hostFocused(right.host)) - Number(hostFocused(left.host)) ||
    left.index - right.index
  );
}

function compareSpaces(
  left: IndexedSpace,
  right: IndexedSpace,
  selectedSpaceId: string | null,
) {
  return (
    Number(right.space.id === selectedSpaceId) -
      Number(left.space.id === selectedSpaceId) ||
    Number(spaceFocused(right.space)) - Number(spaceFocused(left.space)) ||
    Number(spaceNeedsAttention(right.space)) -
      Number(spaceNeedsAttention(left.space)) ||
    agentCount(right.space) - agentCount(left.space) ||
    left.hostIndex - right.hostIndex ||
    left.index - right.index
  );
}

function compareLeaves(
  left: { leaf: WorldLeafObject; index: number },
  right: { leaf: WorldLeafObject; index: number },
  selectedLeafId: string | null,
) {
  return (
    Number(right.leaf.id === selectedLeafId) -
      Number(left.leaf.id === selectedLeafId) ||
    Number(right.leaf.watched) - Number(left.leaf.watched) ||
    Number(right.leaf.focused) - Number(left.leaf.focused) ||
    statusPriority(right.leaf.status) - statusPriority(left.leaf.status) ||
    Number(right.leaf.kind === "agent") - Number(left.leaf.kind === "agent") ||
    left.index - right.index
  );
}

function selectedPath(world: WorldObject, selectedId: string | null) {
  const node = selectedId ? world.nodeById.get(selectedId) : undefined;
  if (!node) return { hostId: null, spaceId: null, leafId: null };
  if (node.kind === "host") {
    return { hostId: node.id, spaceId: null, leafId: null };
  }
  if (node.kind === "space") {
    return { hostId: node.parentId, spaceId: node.id, leafId: null };
  }
  const space = world.nodeById.get(node.parentId);
  return {
    hostId: space?.kind === "space" ? space.parentId : null,
    spaceId: node.parentId,
    leafId: node.id,
  };
}

function hostFocused(host: WorldHostObject) {
  return host.spaces.some(spaceFocused);
}

function hostNeedsAttention(host: WorldHostObject) {
  return host.spaces.some(spaceNeedsAttention);
}

function spaceFocused(space: WorldSpaceObject) {
  return (
    space.workspace.focused || space.children.some(({ focused }) => focused)
  );
}

function spaceNeedsAttention(space: WorldSpaceObject) {
  return space.children.some(({ status }) => statusPriority(status) > 0);
}

function agentCount(space: WorldSpaceObject) {
  return space.children.filter(({ kind }) => kind === "agent").length;
}

function statusPriority(status: WorldAgentStatus) {
  return status === "blocked"
    ? 3
    : status === "working"
      ? 2
      : status === "done"
        ? 1
        : 0;
}
