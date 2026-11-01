import type { WorldObject, WorldSpaceObject } from "./worldObject";
import { presentWorldRooms } from "./worldPresentation";
const rooms = new WeakMap<
  WorldSpaceObject,
  { key: string; room: WorldSpaceObject }
>();
export function worldObjectWithWatches(
  world: WorldObject,
  watches: readonly {
    connectionId: string;
    generation: number;
    terminalId: string;
  }[],
): WorldObject {
  const keys = new Set(
    watches.map((w) =>
      JSON.stringify([w.connectionId, w.generation, w.terminalId]),
    ),
  );
  return presentWorldRooms(world, (space) => {
    const watched = space.children.map((leaf) =>
      keys.has(
        JSON.stringify([leaf.connectionId, leaf.generation, leaf.terminalId]),
      ),
    );
    if (
      watched.every(
        (value, i) => value === (space.children[i]!.watched === true),
      )
    )
      return space;
    const key = JSON.stringify(watched),
      prior = rooms.get(space);
    if (prior?.key === key) return prior.room;
    const room = {
      ...space,
      children: space.children.map((leaf, i) =>
        watched[i] === (leaf.watched === true)
          ? leaf
          : { ...leaf, watched: watched[i] },
      ),
    };
    rooms.set(space, { key, room });
    return room;
  });
}
