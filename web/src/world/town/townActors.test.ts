import { expect, test } from "bun:test";
import { townActorWorld, TownActors } from "./townActors";
import { layoutTown, TOWN_TILE, townSeat } from "./townLayout";
import type { TownModel } from "./townModel";

type Status = "working" | "blocked" | "done" | "idle" | "unknown";

function world(
  statuses: Record<string, Status>,
  deskCount = 4,
  /** Herdr's tab order, as desk indexes; agents keep their desks. */
  order?: number[],
) {
  const deskKeys = Array.from(
    { length: deskCount },
    (_, i) => `room/desk-${i}`,
  );
  const { layout } = layoutTown(
    {
      hosts: [{ key: "host", displayOrder: 0 }],
      rooms: [
        {
          key: "room",
          hostKey: "host",
          order: 0,
          deskKeys: order ? order.map((i) => deskKeys[i]!) : deskKeys,
        },
      ],
    },
    "wide",
  );
  const agents = new Map(
    Object.entries(statuses).map(([key, semanticStatus]) => [
      key,
      { key, hostKey: "host", roomKey: "room", semanticStatus },
    ]),
  );
  const agentSeats = new Map(
    Object.keys(statuses).map((key, index) => [
      key,
      {
        deskKey: deskKeys[index % deskCount]!,
        seat: Math.floor(index / deskCount),
      },
    ]),
  );
  const model = { agents, agentSeats } as unknown as TownModel;
  return { layout, model, actorWorld: townActorWorld(layout, model) };
}

function settle(actors: TownActors) {
  for (let i = 0; i < 2000 && actors.busy; i += 1) actors.step(1 / 30);
  expect(actors.busy).toBe(false);
}

test("agents appear seated at their seat without walking", () => {
  const { actorWorld } = world({ a: "working", b: "unknown" });
  const actors = new TownActors();
  actors.sync(actorWorld, false);
  for (const key of ["a", "b"]) {
    const actor = actors.actors.get(key)!;
    expect(actor.mode).toBe("seat");
    const seat = actorWorld.model.agentSeats.get(key)!;
    const geometry = townSeat(actorWorld.cells.get(seat.deskKey)!, seat.seat);
    expect([actor.x, actor.y]).toEqual([geometry.cx, geometry.seatedY]);
  }
  expect(actors.busy).toBe(false);
});

test("a blocked agent walks to the reception queue and back when answered", () => {
  const before = world({ a: "working" });
  const actors = new TownActors();
  actors.sync(before.actorWorld, false);
  const blocked = world({ a: "blocked" });
  actors.sync(blocked.actorWorld, false);
  expect(actors.busy).toBe(true);
  settle(actors);
  const actor = actors.actors.get("a")!;
  const slot = blocked.layout.buildings[0]!.queue[0]!;
  expect(actor.mode).toBe("stand");
  expect(actor.queueSlot).toBe(0);
  expect([
    Math.floor(actor.x / TOWN_TILE),
    Math.floor((actor.y - 1) / TOWN_TILE),
  ]).toEqual([slot.x, slot.y]);
  expect(actor.dir).toBe("up");
  actors.sync(world({ a: "working" }).actorWorld, false);
  settle(actors);
  expect(actors.actors.get("a")!.mode).toBe("seat");
});

test("the reception queue is ordered by when agents became blocked", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working", b: "working" }).actorWorld, false);
  actors.step(1);
  actors.sync(world({ a: "working", b: "blocked" }).actorWorld, false);
  actors.step(1);
  actors.sync(world({ a: "blocked", b: "blocked" }).actorWorld, false);
  expect(actors.actors.get("b")!.queueSlot).toBe(0);
  expect(actors.actors.get("a")!.queueSlot).toBe(1);
});

test("blocked agents beyond the queue stay at their seat", () => {
  const statuses = Object.fromEntries(
    Array.from({ length: 13 }, (_, i) => [`agent-${i}`, "blocked" as Status]),
  );
  const actors = new TownActors();
  actors.sync(world(statuses, 13).actorWorld, true);
  const queued = [...actors.actors.values()].filter(
    (a) => a.queueSlot !== null,
  );
  expect(queued.length).toBe(10);
  expect(
    [...actors.actors.values()].filter((a) => a.mode === "seat").length,
  ).toBe(3);
});

test("idle agents take distinct lounge spots", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "idle", b: "idle", c: "idle" }).actorWorld, true);
  const spots = [...actors.actors.values()].map(
    (a) => `${a.spot!.x},${a.spot!.y}`,
  );
  expect(new Set(spots).size).toBe(3);
  for (const actor of actors.actors.values()) expect(actor.mode).toBe("stand");
});

test("instant sync teleports instead of walking", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working" }).actorWorld, false);
  actors.sync(world({ a: "blocked" }).actorWorld, true);
  expect(actors.busy).toBe(false);
  expect(actors.actors.get("a")!.queueSlot).toBe(0);
});

test("an agent whose desk is no longer presented leaves the scene", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working", b: "working" }).actorWorld, false);
  actors.sync(world({ a: "working" }).actorWorld, false);
  expect([...actors.actors.keys()]).toEqual(["a"]);
});

test("finished agents queue at reception after waiting agents", () => {
  const actors = new TownActors();
  actors.sync(
    world({ a: "done", b: "blocked", c: "working" }).actorWorld,
    true,
  );
  expect(actors.actors.get("b")!.goal).toEqual({ kind: "queue", slot: 0 });
  expect(actors.actors.get("a")!.goal).toEqual({ kind: "queue", slot: 1 });
  expect(actors.actors.get("c")!.goal?.kind).toBe("seat");
});

test("seated agents move with their desk when Herdr reorders it", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working" }).actorWorld, false);
  const moved = world({ a: "working" }, 4, [3, 0, 1, 2]);
  actors.sync(moved.actorWorld, false);
  const actor = actors.actors.get("a")!;
  const geometry = townSeat(moved.actorWorld.cells.get("room/desk-0")!, 0);
  expect(actor.mode).toBe("seat");
  expect([actor.x, actor.y]).toEqual([geometry.cx, geometry.seatedY]);
});

test("an agent walking back to a desk that moved walks to its new place", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working" }).actorWorld, false);
  actors.sync(world({ a: "blocked" }).actorWorld, false);
  settle(actors);
  actors.sync(world({ a: "working" }).actorWorld, false);
  for (let i = 0; i < 10; i += 1) actors.step(1 / 30);
  expect(actors.actors.get("a")!.mode).toBe("walk");
  const moved = world({ a: "working" }, 4, [3, 0, 1, 2]);
  actors.sync(moved.actorWorld, false);
  const geometry = townSeat(moved.actorWorld.cells.get("room/desk-0")!, 0);
  // The path now ends at the new seat's aisle, not the old one.
  const { path } = actors.actors.get("a")!;
  expect(path[path.length - 1]).toEqual([
    geometry.entry.x * TOWN_TILE + 8,
    geometry.entry.y * TOWN_TILE + 13,
  ]);
  settle(actors);
  const actor = actors.actors.get("a")!;
  expect(actor.mode).toBe("seat");
  expect([actor.x, actor.y]).toEqual([geometry.cx, geometry.seatedY]);
});
