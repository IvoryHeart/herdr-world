import {
  emptyStatusCounts,
  type WorldLeafObject,
  type WorldHostObject,
  type WorldObject,
  type WorldObjectNode,
  type WorldSpaceObject,
} from "./worldObject";

/**
 * A host-filtered World's nodes by id: a query of the full World's index
 * for the included hosts, so filtering does not index every node again.
 */
class HostFilteredNodeIndex implements ReadonlyMap<string, WorldObjectNode> {
  constructor(
    private readonly all: ReadonlyMap<string, WorldObjectNode>,
    private readonly connectionIds: ReadonlySet<string>,
    private readonly nodes: readonly WorldObjectNode[],
  ) {}
  get(id: string) {
    const node = this.all.get(id);
    return node && this.connectionIds.has(node.connectionId) ? node : undefined;
  }
  has(id: string) {
    return this.get(id) !== undefined;
  }
  get size() {
    return this.nodes.length;
  }
  forEach(
    callback: (
      node: WorldObjectNode,
      id: string,
      map: ReadonlyMap<string, WorldObjectNode>,
    ) => void,
    thisArg?: unknown,
  ) {
    for (const node of this.nodes) callback.call(thisArg, node, node.id, this);
  }
  entries() {
    return this.nodes
      .map((node): [string, WorldObjectNode] => [node.id, node])
      .values();
  }
  keys() {
    return this.nodes.map((node) => node.id).values();
  }
  values() {
    return this.nodes.values();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}

// The last host filter of each World, shared by the views and the shell that
// present the same World under the same filter.
const filteredWorlds = new WeakMap<
  WorldObject,
  { key: string; world: WorldObject }
>();

/**
 * Keeps aggregate observation intact while giving a focused client one coherent
 * host presentation. The returned nodes are the original qualified objects, so
 * identities and runtime generations cannot be rebound by the projection.
 */
export function worldObjectForHosts(
  world: WorldObject,
  connectionIds: readonly string[] | null,
): WorldObject {
  if (connectionIds === null) return world;
  const key = JSON.stringify(connectionIds);
  const cached = filteredWorlds.get(world);
  if (cached?.key === key) return cached.world;
  const ids = new Set(connectionIds);
  const hosts = world.hosts.filter((host) => ids.has(host.connectionId));
  const spaces: WorldSpaceObject[] = [];
  const leaves: WorldLeafObject[] = [];
  const nodes: WorldObjectNode[] = [];
  // One pass, in the order a build indexes them: each host, then each of its
  // spaces followed by that space's leaves.
  for (const host of hosts) {
    nodes.push(host);
    for (const space of host.spaces) {
      spaces.push(space);
      nodes.push(space);
      for (const leaf of space.children) {
        leaves.push(leaf);
        nodes.push(leaf);
      }
    }
  }
  const coverage = {
    spaces: 0,
    tabs: 0,
    leaves: 0,
    agents: 0,
    shells: 0,
    status: emptyStatusCounts(),
  };
  for (const host of hosts) {
    for (const key of ["spaces", "tabs", "leaves", "agents", "shells"] as const)
      coverage[key] += host.coverage[key];
    for (const key of Object.keys(
      coverage.status,
    ) as (keyof typeof coverage.status)[])
      coverage.status[key] += host.coverage.status[key];
  }
  const filtered: WorldObject = {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new HostFilteredNodeIndex(world.nodeById, ids, nodes),
    coverage,
  };
  filteredWorlds.set(world, { key, world: filtered });
  return filtered;
}

// Fingerprint only the consumed room projection. Even a change to an unwatched
// pane in the same source room must retain its watched presentation. Workspace
// lifetime and two variants bound retention, including qualification metadata.
const watchedRooms = new WeakMap<
  WorldSpaceObject["workspace"],
  Map<string, WorldSpaceObject>
>();

// Preparation and rendering share the same projected host when its source and
// ordered consumed rooms are unchanged. The source key includes current owner
// metadata; changing health/generation cannot reuse a prior host presentation.
const watchedHosts = new WeakMap<WorldHostObject, WorldHostObject>();

/** Keeps ancestry for a browser-local watched-only presentation. */
export function worldObjectForWatches(
  world: WorldObject,
  watches: readonly {
    connectionId: string;
    generation: number;
    terminalId: string;
  }[],
): WorldObject {
  const keys = new Set(
    watches.map(({ connectionId, generation, terminalId }) =>
      JSON.stringify([connectionId, generation, terminalId]),
    ),
  );
  const hosts = world.hosts.flatMap((host) => {
    const spaces = host.spaces.flatMap((space) => {
      const children = space.children.filter((leaf) =>
        keys.has(
          JSON.stringify([leaf.connectionId, leaf.generation, leaf.terminalId]),
        ),
      );
      if (!children.length) return [];
      const tabs = space.tabs.filter((tab) =>
        children.some((leaf) => leaf.tabId === tab.tab_id),
      );
      const status = emptyStatusCounts();
      for (const leaf of children)
        if (leaf.kind === "agent") status[leaf.status]++;
      const agents = children.filter((leaf) => leaf.kind === "agent").length;
      const room = {
        ...space,
        children,
        tabs,
        coverage: {
          spaces: 1,
          tabs: tabs.length,
          leaves: children.length,
          agents,
          shells: children.length - agents,
          status,
        },
      };
      const key = JSON.stringify(room);
      let variants = watchedRooms.get(space.workspace);
      if (!variants) watchedRooms.set(space.workspace, (variants = new Map()));
      const cached = variants.get(key);
      if (cached) return [cached];
      if (variants.size >= 2) variants.delete(variants.keys().next().value!);
      variants.set(key, room);
      return [room];
    });
    if (!spaces.length) return [];
    const cached = watchedHosts.get(host);
    if (
      cached?.spaces.length === spaces.length &&
      spaces.every((space, i) => space === cached.spaces[i])
    )
      return [cached];
    const coverage = {
      spaces: spaces.length,
      tabs: 0,
      leaves: 0,
      agents: 0,
      shells: 0,
      status: emptyStatusCounts(),
    };
    for (const space of spaces) {
      for (const key of ["tabs", "leaves", "agents", "shells"] as const)
        coverage[key] += space.coverage[key];
      for (const key of Object.keys(
        coverage.status,
      ) as (keyof typeof coverage.status)[])
        coverage.status[key] += space.coverage.status[key];
    }
    const watchedHost = { ...host, spaces, coverage };
    watchedHosts.set(host, watchedHost);
    return [watchedHost];
  });
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  return worldObjectForHosts(
    {
      ...world,
      hosts,
      spaces,
      leaves,
      nodes,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
    },
    hosts.map((host) => host.connectionId),
  );
}
