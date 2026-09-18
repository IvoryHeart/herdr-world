import type {
  WorldAgentStatus,
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldObjectKind,
  WorldObjectNode,
  WorldSpaceObject,
} from "../worldObject";

export const GRAPH_PRESENTATION_BOUNDS = Object.freeze({
  hosts: 128,
  spaces: 128,
  childrenPerSpace: 16,
});

export type WorldGraphNode = {
  id: string;
  kind: WorldObjectKind;
  parentId: string | null;
  label: string;
  hostLabel: string;
  status: WorldAgentStatus;
  focused: boolean;
  stale: boolean;
  actionable: boolean;
  omittedChildCount: number;
  searchText: string;
  source: WorldObjectNode;
};

export type WorldGraphEdge = {
  sourceId: string;
  targetId: string;
  kind: "contains";
};

export type WorldGraphSpace = {
  node: WorldGraphNode;
  children: WorldGraphNode[];
  observedChildCount: number;
  omittedChildCount: number;
};

export type WorldGraphHost = {
  node: WorldGraphNode;
  spaces: WorldGraphSpace[];
  observedSpaceCount: number;
  omittedSpaceCount: number;
};

export type WorldGraphProjection = {
  version: 1;
  nodes: WorldGraphNode[];
  edges: WorldGraphEdge[];
  hosts: WorldGraphHost[];
  spaces: WorldGraphSpace[];
  omittedHostCount: number;
  omittedSpaceCount: number;
  coverage: {
    configuredHosts: number;
    presentedHosts: number;
    observedSpaces: number;
    presentedSpaces: number;
    observedAgents: number;
    presentedAgents: number;
    omittedAgents: number;
    observedTerminals: number;
    presentedTerminals: number;
    omittedTerminals: number;
    observedShells: number;
    presentedShells: number;
  };
  presentationBounds: typeof GRAPH_PRESENTATION_BOUNDS;
};

type IndexedHost = { host: WorldHostObject; index: number };
type IndexedSpace = {
  host: WorldHostObject;
  space: WorldSpaceObject;
  hostIndex: number;
  index: number;
};

export function projectWorldGraph(
  world: WorldObject,
  selectedId: string | null = null,
): WorldGraphProjection {
  const selected = selectedPath(world, selectedId);
  const presentedHosts = world.hosts
    .map((host, index): IndexedHost => ({ host, index }))
    .sort((left, right) => compareHosts(left, right, selected.hostId))
    .slice(0, GRAPH_PRESENTATION_BOUNDS.hosts);
  const presentedHostIds = new Set(presentedHosts.map(({ host }) => host.id));
  const spaces = world.spaces
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
    .slice(0, GRAPH_PRESENTATION_BOUNDS.spaces);
  const projectedSpaceById = new Map(
    spaces.map(({ space }) => {
      const projected = projectSpace(space, selected.leafId);
      return [space.id, projected] as const;
    }),
  );
  const hosts = presentedHosts.map(({ host }) =>
    projectHost(
      host,
      host.spaces.flatMap((space) => {
        const projected = projectedSpaceById.get(space.id);
        return projected ? [projected] : [];
      }),
    ),
  );
  const graphSpaces = hosts.flatMap((host) => host.spaces);
  const nodes = hosts.flatMap(({ node, spaces: hostSpaces }) => [
    node,
    ...hostSpaces.flatMap((space) => [space.node, ...space.children]),
  ]);
  const edges = hosts.flatMap(({ node: host, spaces: hostSpaces }) => [
    ...hostSpaces.map(
      ({ node: space }): WorldGraphEdge => ({
        sourceId: host.id,
        targetId: space.id,
        kind: "contains",
      }),
    ),
    ...hostSpaces.flatMap(({ node: space, children }) =>
      children.map(
        (child): WorldGraphEdge => ({
          sourceId: space.id,
          targetId: child.id,
          kind: "contains",
        }),
      ),
    ),
  ]);
  const presentedLeaves = graphSpaces.flatMap(({ children }) => children);
  const observedAgents = world.leaves.filter(
    ({ kind }) => kind === "agent",
  ).length;
  const presentedAgents = presentedLeaves.filter(
    ({ kind }) => kind === "agent",
  ).length;

  return {
    version: 1,
    nodes,
    edges,
    hosts,
    spaces: graphSpaces,
    omittedHostCount:
      world.omittedHostCount + Math.max(0, world.hosts.length - hosts.length),
    omittedSpaceCount: Math.max(0, world.spaces.length - graphSpaces.length),
    coverage: {
      configuredHosts: world.omittedHostCount + world.hosts.length,
      presentedHosts: hosts.length,
      observedSpaces: world.spaces.length,
      presentedSpaces: graphSpaces.length,
      observedAgents,
      presentedAgents,
      omittedAgents: Math.max(0, observedAgents - presentedAgents),
      observedTerminals: world.leaves.length,
      presentedTerminals: presentedLeaves.length,
      omittedTerminals: Math.max(
        0,
        world.leaves.length - presentedLeaves.length,
      ),
      observedShells: world.leaves.length - observedAgents,
      presentedShells: presentedLeaves.length - presentedAgents,
    },
    presentationBounds: GRAPH_PRESENTATION_BOUNDS,
  };
}

function projectHost(
  host: WorldHostObject,
  spaces: WorldGraphSpace[],
): WorldGraphHost {
  return {
    node: graphNode(
      host,
      aggregateStatus(host.spaces.flatMap(({ children }) => children)),
      host.spaces.some(
        ({ workspace, children }) =>
          workspace.focused || children.some(({ focused }) => focused),
      ),
      Math.max(0, host.spaces.length - spaces.length),
    ),
    spaces,
    observedSpaceCount: host.spaces.length,
    omittedSpaceCount: Math.max(0, host.spaces.length - spaces.length),
  };
}

function projectSpace(
  space: WorldSpaceObject,
  selectedLeafId: string | null,
): WorldGraphSpace {
  const children = space.children
    .map((leaf, index) => ({ leaf, index }))
    .sort((left, right) => compareLeaves(left, right, selectedLeafId))
    .slice(0, GRAPH_PRESENTATION_BOUNDS.childrenPerSpace)
    .map(({ leaf }) => graphNode(leaf, leaf.status, leaf.focused, 0));
  const omittedChildCount = Math.max(
    0,
    space.children.length - children.length,
  );
  return {
    node: graphNode(
      space,
      aggregateStatus(space.children),
      space.workspace.focused || space.children.some(({ focused }) => focused),
      omittedChildCount,
    ),
    children,
    observedChildCount: space.children.length,
    omittedChildCount,
  };
}

function graphNode(
  source: WorldObjectNode,
  status: WorldAgentStatus,
  focused: boolean,
  omittedChildCount: number,
): WorldGraphNode {
  const leaf = source.kind === "agent" || source.kind === "terminal";
  return {
    id: source.id,
    kind: source.kind,
    parentId: source.parentId,
    label: source.label,
    hostLabel: source.hostLabel,
    status,
    focused,
    stale: source.stale,
    actionable: source.actionable,
    omittedChildCount,
    searchText: [
      source.label,
      source.hostLabel,
      source.connectionId,
      source.kind,
      source.hostState,
      leaf ? source.agentLabel : null,
      leaf ? source.modelLabel : null,
      leaf ? source.taskSummary : null,
      leaf ? source.stateLabels[source.status] : null,
      source.stale ? "stale offline" : null,
    ]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase(),
    source,
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

function aggregateStatus(leaves: readonly WorldLeafObject[]): WorldAgentStatus {
  for (const status of ["blocked", "working", "done", "idle"] as const) {
    if (leaves.some((leaf) => leaf.status === status)) return status;
  }
  return "unknown";
}
