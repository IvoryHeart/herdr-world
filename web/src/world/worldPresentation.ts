import type {
  WorldHostObject,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";
const hosts = new WeakMap<
  WorldHostObject,
  { spaces: WorldSpaceObject[]; host: WorldHostObject }
>();
const worlds = new WeakMap<
  WorldObject,
  { hosts: WorldHostObject[]; world: WorldObject }
>();
const same = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Overlays retain every host/room they do not change, including across document edits. */
export function presentWorldRooms(
  world: WorldObject,
  present: (space: WorldSpaceObject) => WorldSpaceObject,
): WorldObject {
  const nextHosts = world.hosts.map((host) => {
    const spaces = host.spaces.map(present);
    if (same(spaces, host.spaces)) return host;
    const old = hosts.get(host);
    if (old && same(spaces, old.spaces)) return old.host;
    const next = { ...host, spaces };
    hosts.set(host, { spaces, host: next });
    return next;
  });
  if (same(nextHosts, world.hosts)) return world;
  const old = worlds.get(world);
  if (old && same(nextHosts, old.hosts)) return old.world;
  const spaces = nextHosts.flatMap((host) => host.spaces),
    leaves = spaces.flatMap((space) => space.children);
  const nodes = nextHosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space) => [space, ...space.children]),
  ]);
  const next = {
    ...world,
    hosts: nextHosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
  worlds.set(world, { hosts: nextHosts, world: next });
  return next;
}
