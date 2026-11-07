import { expect, test } from "bun:test";
import {
  TOWN_OVERFLOW_DOZE,
  townActorWorld,
  TownActors,
  townCrowdSpots,
} from "./townActors";
import { layoutTown, TOWN_SHAPES, TOWN_TILE, townSeat } from "./townLayout";
import type { TownModel } from "./townModel";

type Status = "working" | "blocked" | "done" | "idle" | "unknown";

function world(
  statuses: Record<string, Status>,
  deskCount = 4,
  /** Herdr's tab order, as desk indexes; agents keep their desks. */
  order?: number[],
  /** Pinned desks, as desk indexes. */
  pinned: number[] = [],
  precedingHost = false,
) {
  const deskKeys = Array.from(
    { length: deskCount },
    (_, i) => `room/desk-${i}`,
  );
  const { layout } = layoutTown(
    {
      hosts: [
        ...(precedingHost ? [{ key: "earlier", displayOrder: 0 }] : []),
        { key: "host", displayOrder: precedingHost ? 1 : 0 },
      ],
      rooms: [
        ...(precedingHost
          ? [
              {
                key: "earlier-room",
                hostKey: "earlier",
                order: 0,
                deskKeys: ["earlier-desk"],
              },
            ]
          : []),
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
  const deskPins = new Map(
    pinned.map((i) => [deskKeys[i]!, { key: `pin-${i}`, cell: null }]),
  );
  const model = { agents, agentSeats, deskPins } as unknown as TownModel;
  return { layout, model, actorWorld: townActorWorld(layout, model) };
}

function settle(actors: TownActors) {
  for (let i = 0; i < 2000 && actors.busy; i += 1) actors.step(1 / 30);
  expect(actors.busy).toBe(false);
}

test("an open ask waits at reception until answered, even if its agent was opened", () => {
  const { actorWorld } = world({ a: "idle", b: "working" });
  const actors = new TownActors();
  actors.sync(actorWorld, true, new Set(["a"]), new Set(["a", "b"]));
  expect(actors.actors.get("a")!.goal!.kind).toBe("queue");
  expect(actors.actors.get("b")!.goal!.kind).toBe("queue");
  actors.sync(actorWorld, true, new Set(["a"]), new Set());
  expect(actors.actors.get("a")!.goal!.kind).toBe("seat");
  expect(actors.actors.get("b")!.goal!.kind).toBe("seat");
});

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

/** `count` agents with `status`, blocked one second apart in index order. */
function overflowing(
  count: number,
  status: Status = "blocked",
  form: "wide" | "phone" = "wide",
) {
  const keys = Array.from(
    { length: count },
    (_, i) => `agent-${String(i).padStart(2, "0")}`,
  );
  const make = (statuses: Record<string, Status>) =>
    form === "wide" ? world(statuses, count) : phoneWorld(statuses);
  const actors = new TownActors();
  const statuses: Record<string, Status> = Object.fromEntries(
    keys.map((key) => [key, "working" as Status]),
  );
  actors.sync(make(statuses).actorWorld, true);
  for (const key of keys) {
    statuses[key] = status;
    actors.sync(make({ ...statuses }).actorWorld, true);
    actors.step(1);
  }
  return { actors, keys, make, statuses };
}

function phoneWorld(statuses: Record<string, Status>) {
  const keys = Object.keys(statuses);
  const deskKeys = keys.map((_, i) => `room/desk-${i}`);
  const { layout } = layoutTown(
    {
      hosts: [{ key: "host", displayOrder: 0 }],
      rooms: [{ key: "room", hostKey: "host", order: 0, deskKeys }],
    },
    TOWN_SHAPES.phone,
  );
  const model = {
    agents: new Map(
      keys.map((key) => [
        key,
        {
          key,
          hostKey: "host",
          roomKey: "room",
          semanticStatus: statuses[key],
        },
      ]),
    ),
    agentSeats: new Map(
      keys.map((key, i) => [key, { deskKey: deskKeys[i]!, seat: 0 }]),
    ),
    deskPins: new Map(),
  } as unknown as TownModel;
  return { layout, model, actorWorld: townActorWorld(layout, model) };
}

const tileOf = (actor: { x: number; y: number }) => [
  Math.floor(actor.x / TOWN_TILE),
  Math.floor((actor.y - 1) / TOWN_TILE),
];

test("agents beyond the reception queue crowd the lobby in queue order", () => {
  const { actors, keys } = overflowing(13);
  settle(actors);
  expect(keys.map((key) => actors.actors.get(key)!.goal)).toEqual([
    ...Array.from({ length: 10 }, (_, slot) => ({
      kind: "queue" as const,
      slot,
    })),
    ...Array.from({ length: 3 }, (_, slot) => ({
      kind: "crowd" as const,
      slot,
    })),
  ]);
  for (const key of keys.slice(10)) {
    const actor = actors.actors.get(key)!;
    expect(actor.mode).toBe("stand");
    expect(actors.mood(actor)).toBe("grumble");
  }
});

test("finished agents overflow after waiting ones, and the crowd keeps that order", () => {
  const { actors, make, statuses } = overflowing(12, "done");
  // Two agents block later than every finish, yet wait ahead of finished ones.
  statuses["agent-11"] = "blocked";
  actors.sync(make({ ...statuses }).actorWorld, true);
  actors.step(1);
  statuses["agent-10"] = "blocked";
  actors.sync(make({ ...statuses }).actorWorld, true);
  const goal = (key: string) => actors.actors.get(key)!.goal;
  expect(goal("agent-11")).toEqual({ kind: "queue", slot: 0 });
  expect(goal("agent-10")).toEqual({ kind: "queue", slot: 1 });
  expect(goal("agent-07")).toEqual({ kind: "queue", slot: 9 });
  expect(goal("agent-08")).toEqual({ kind: "crowd", slot: 0 });
  expect(goal("agent-09")).toEqual({ kind: "crowd", slot: 1 });
});

test("a grumbler naps after the overflow timeout, counted from joining the crowd", () => {
  const { actors, keys, make, statuses } = overflowing(12);
  settle(actors);
  const first = actors.actors.get(keys[10]!)!;
  const second = actors.actors.get(keys[11]!)!;
  expect(actors.mood(first)).toBe("grumble");
  // agent-10 joined one second before agent-11, and agent-11 joined at the
  // last step.
  actors.step(TOWN_OVERFLOW_DOZE - 0.5);
  expect(actors.mood(first)).toBe("nap");
  expect(actors.mood(second)).toBe("grumble");
  expect(actors.dozeIn(second)).toBeCloseTo(0.5);
  actors.step(0.5);
  expect(actors.mood(second)).toBe("nap");
  // Napping is presentation only; an answered agent walks back to its desk.
  statuses[keys[11]!] = "working";
  actors.sync(make({ ...statuses }).actorWorld, false);
  expect(actors.mood(second)).toBeNull();
  expect(second.crowdSince).toBe(0);
  settle(actors);
  expect(second.mode).toBe("seat");
});

test("reduced motion keeps the doze timer on real time", () => {
  const { actors, keys } = overflowing(11);
  const actor = actors.actors.get(keys[10]!)!;
  actors.step(10, 1 / 60);
  expect(actors.mood(actor)).toBe("grumble");
});

test("a freed queue slot takes the front of the crowd, which walks there while the rest move up", () => {
  const { actors, keys, make, statuses } = overflowing(13);
  settle(actors);
  actors.step(TOWN_OVERFLOW_DOZE);
  const front = actors.actors.get(keys[10]!)!;
  expect(actors.mood(front)).toBe("nap");
  statuses[keys[0]!] = "working";
  actors.sync(make({ ...statuses }).actorWorld, false);
  expect(front.goal).toEqual({ kind: "queue", slot: 9 });
  expect(actors.mood(front)).toBeNull();
  expect(actors.actors.get(keys[11]!)!.goal).toEqual({
    kind: "crowd",
    slot: 0,
  });
  expect(actors.actors.get(keys[12]!)!.goal).toEqual({
    kind: "crowd",
    slot: 1,
  });
  // Every move transitions: a napper gets up where it lies, then walks;
  // nobody teleports into the slot or the next spot.
  const [x, y] = [front.x, front.y];
  expect(front.mode).toBe("tween");
  expect(front.rest).toBe(1);
  actors.step(0.25);
  expect(front.rest).toBeCloseTo(0.5);
  expect([front.x, front.y]).toEqual([x, y]);
  actors.step(0.26);
  expect(front.rest).toBe(0);
  expect(front.mode).toBe("walk");
  expect(actors.actors.get(keys[11]!)!.mode).toBe("walk");
  settle(actors);
  expect(front.queueSlot).toBe(9);
  // A shuffled napper keeps its overflow time and lies back down.
  expect(actors.mood(actors.actors.get(keys[11]!)!)).toBe("nap");
});

for (const form of ["wide", "phone"] as const)
  test(`${form} crowd spots stay clear of the queue rug, counter, door and plants`, () => {
    const { actors, keys, make, statuses } = overflowing(14, "blocked", form);
    settle(actors);
    const { layout, actorWorld } = make({ ...statuses });
    const building = layout.buildings[0]!;
    const spots = townCrowdSpots(building, actorWorld.navigation.get("host")!);
    expect(spots.length).toBeGreaterThanOrEqual(form === "phone" ? 10 : 16);
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(spots.length);
    for (const spot of spots) {
      expect(spot.x < building.doorX - 6 || spot.x > building.doorX + 5).toBe(
        true,
      );
      expect(spot.x).not.toBe(building.entryX);
      expect(spot.x).toBeGreaterThan(building.x + 1);
      expect(spot.x).toBeLessThan(building.x + building.w - 2);
      expect(spot.y).toBeGreaterThan(building.lobbyY);
      expect(spot.y).toBeLessThan(building.lobbyY + 6);
      for (const plant of building.plants)
        expect([spot.x, spot.y]).not.toEqual([plant.x, plant.y]);
      // Facing the counter.
      expect(spot.face).toBe(spot.x < building.doorX ? "right" : "left");
    }
    for (const [slot, key] of keys.slice(10).entries()) {
      const actor = actors.actors.get(key)!;
      expect(tileOf(actor)).toEqual([spots[slot]!.x, spots[slot]!.y]);
    }
  });

test("a grumbler lies down on the floor gradually rather than snapping", () => {
  const { actors, keys } = overflowing(11);
  settle(actors);
  const actor = actors.actors.get(keys[10]!)!;
  // The renderer caps motion per frame (dt) but not the clock (elapsed).
  actors.step(0, actors.dozeIn(actor));
  expect(actors.mood(actor)).toBe("nap");
  expect(actor.rest).toBe(0);
  expect(actors.busy).toBe(true);
  actors.step(0.25);
  expect(actor.rest).toBeCloseTo(0.5);
  actors.step(0.25);
  expect(actor.rest).toBe(1);
  expect(actors.busy).toBe(false);
});

test("a sync after a long quiet spell doesn't charge it to the new crowd", () => {
  const { actors, keys, make, statuses } = overflowing(10);
  settle(actors);
  // The renderer drew nothing for two minutes; then overflow appears, and
  // the next frame advances the clock by the whole gap.
  statuses["late"] = "blocked";
  actors.sync(make({ ...statuses }).actorWorld, false);
  const late = actors.actors.get("late")!;
  expect(late.goal).toEqual({ kind: "crowd", slot: 0 });
  actors.step(0.05, 120);
  expect(actors.dozeIn(late)).toBe(TOWN_OVERFLOW_DOZE);
  settle(actors);
  expect(actors.mood(late)).toBe("grumble");
  expect(keys.length).toBe(10);
});

for (const form of ["wide", "phone"] as const)
  test(`${form}: every overflow agent gathers at reception, however many`, () => {
    const { actors, keys, make, statuses } = overflowing(30, "blocked", form);
    settle(actors);
    const { layout, actorWorld } = make({ ...statuses });
    const building = layout.buildings[0]!;
    const spots = townCrowdSpots(building, actorWorld.navigation.get("host")!);
    const overflow = keys.slice(10).map((key) => actors.actors.get(key)!);
    expect(overflow.map((actor) => actor.goal)).toEqual(
      overflow.map((_, slot) => ({ kind: "crowd", slot })),
    );
    const points = new Set<string>();
    for (const [slot, actor] of overflow.entries()) {
      expect(actor.mode).toBe("stand");
      const spot = spots[slot % spots.length]!;
      expect(tileOf(actor)).toEqual([spot.x, spot.y]);
      points.add(`${actor.x},${actor.y}`);
    }
    // Agents sharing a spot huddle apart rather than stack exactly.
    expect(points.size).toBe(overflow.length);
    expect(
      [...actors.actors.values()].filter((actor) => actor.mode === "seat"),
    ).toEqual([]);
  });

test("an unknown agent stays at its desk", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working" }).actorWorld, false);
  actors.sync(world({ a: "unknown" }).actorWorld, false);
  expect(actors.actors.get("a")!.goal?.kind).toBe("seat");
  expect(actors.actors.get("a")!.mode).toBe("seat");
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

test("an opened agent walks back to its desk from reception or the lounge", () => {
  const away = world({ done: "done", resting: "idle", waiting: "blocked" });
  const actors = new TownActors();
  actors.sync(
    world({ done: "working", resting: "working", waiting: "working" })
      .actorWorld,
    false,
  );
  actors.sync(away.actorWorld, false);
  settle(actors);
  expect(actors.actors.get("done")!.goal?.kind).toBe("queue");
  expect(actors.actors.get("resting")!.goal?.kind).toBe("lounge");
  actors.sync(away.actorWorld, false, new Set(["done", "resting"]));
  settle(actors);
  for (const key of ["done", "resting"]) {
    expect(actors.actors.get(key)!.goal?.kind).toBe("seat");
    expect(actors.actors.get(key)!.mode).toBe("seat");
  }
  // The others move up the queue; the summoned agent leaves it.
  expect(actors.actors.get("waiting")!.queueSlot).toBe(0);
  // Once no longer summoned, status places it again.
  actors.sync(away.actorWorld, false, new Set());
  settle(actors);
  expect(actors.actors.get("resting")!.goal?.kind).toBe("lounge");
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

test("an agent sitting down at a desk that moved gets up and sits at its new place", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working" }).actorWorld, false);
  actors.sync(world({ a: "blocked" }).actorWorld, false);
  settle(actors);
  actors.sync(world({ a: "working" }).actorWorld, false);
  for (let i = 0; i < 2000 && actors.actors.get("a")!.mode !== "tween"; i += 1)
    actors.step(1 / 60);
  // Past the stand-up tween: now the sit-down one at the desk.
  for (let i = 0; i < 2000; i += 1) {
    const actor = actors.actors.get("a")!;
    if (actor.mode === "tween" && actor.tween?.next === "seat") break;
    actors.step(1 / 60);
  }
  expect(actors.actors.get("a")!.tween?.next).toBe("seat");
  const moved = world({ a: "working" }, 4, [1, 0, 2, 3]);
  actors.sync(moved.actorWorld, false);
  settle(actors);
  const actor = actors.actors.get("a")!;
  const geometry = townSeat(moved.actorWorld.cells.get("room/desk-0")!, 0);
  expect(actor.mode).toBe("seat");
  expect([actor.x, actor.y]).toEqual([geometry.cx, geometry.seatedY]);
});

test("an agent at a pinned desk never goes to the lounge", () => {
  const actors = new TownActors();
  actors.sync(
    world({ a: "working", b: "working" }, 4, undefined, [0]).actorWorld,
    false,
  );
  actors.sync(
    world({ a: "idle", b: "idle" }, 4, undefined, [0]).actorWorld,
    false,
  );
  settle(actors);
  // a sits at pinned desk 0; b's desk is not pinned, so b takes a break.
  expect(actors.actors.get("a")!.mode).toBe("seat");
  expect(actors.actors.get("a")!.spot).toBeNull();
  expect(actors.actors.get("b")!.spot).not.toBeNull();
});

test("a pinned agent waits at reception on doubt or completion, then walks straight back", () => {
  for (const status of ["blocked", "done"] as const) {
    const actors = new TownActors();
    const pinned = (s: Status) => world({ a: s }, 4, undefined, [0]).actorWorld;
    actors.sync(pinned("working"), false);
    actors.sync(pinned(status), false);
    settle(actors);
    expect(actors.actors.get("a")!.queueSlot).toBe(0);
    // Seen (Town presents a checked finish as idle): back to the desk, not
    // the lounge.
    actors.sync(pinned("idle"), false);
    const goal = actors.actors.get("a")!.goal;
    expect(goal?.kind).toBe("seat");
    settle(actors);
    expect(actors.actors.get("a")!.mode).toBe("seat");
    expect(actors.actors.get("a")!.spot).toBeNull();
  }
});

test("unpinning lets an idle agent go to the lounge again", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "idle" }, 4, undefined, [0]).actorWorld, true);
  expect(actors.actors.get("a")!.mode).toBe("seat");
  actors.sync(world({ a: "idle" }).actorWorld, false);
  expect(actors.actors.get("a")!.goal?.kind).toBe("lounge");
});

test("stale agents freeze without keeping an animation loop alive and resume on recovery", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working" }).actorWorld, true);
  const moving = world({ a: "blocked" });
  actors.sync(moving.actorWorld, false);
  expect(actors.busy).toBe(true);
  moving.model.agents.get("a")!.stale = true;
  const actor = actors.actors.get("a")!;
  const position = [actor.x, actor.y];
  for (let i = 0; i < 20; i++) expect(actors.step(1 / 30)).toBe(false);
  expect([actor.x, actor.y]).toEqual(position);
  expect(actors.busy).toBe(false);
  moving.model.agents.get("a")!.stale = false;
  expect(actors.step(1 / 30)).toBe(true);
  expect([actor.x, actor.y]).not.toEqual(position);
});

test("reception walkers leaving their seats use the latest snapshot layout", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "working", b: "working" }).actorWorld, false);
  actors.sync(world({ a: "blocked", b: "done" }).actorWorld, false);
  actors.step(0.1);
  expect(actors.actors.get("a")!.tween?.next).toBe("stand");
  const updated = world({ a: "blocked", b: "done" }, 20);
  actors.sync(updated.actorWorld, false);
  settle(actors);
  for (const actor of actors.actors.values()) {
    const spot =
      updated.actorWorld.buildings.get("host")!.queue[actor.queueSlot!]!;
    expect([actor.x, actor.y]).toEqual([
      spot.x * TOWN_TILE + 8,
      spot.y * TOWN_TILE + 13,
    ]);
    expect(actor.mode).toBe("stand");
  }
});

test("lounge agents retain distinct current-building spots after a snapshot relocates it", () => {
  const actors = new TownActors();
  actors.sync(world({ a: "idle", b: "idle", c: "working" }).actorWorld, true);
  const updated = world(
    { a: "idle", b: "idle", c: "idle" },
    4,
    undefined,
    [],
    true,
  );
  actors.sync(updated.actorWorld, false);
  // Resting occupants move with the building, rather than walking across town.
  for (const key of ["a", "b"]) {
    const actor = actors.actors.get(key)!;
    expect(actor.mode).toBe("stand");
    expect([actor.x, actor.y]).toEqual([
      actor.spot!.x * TOWN_TILE + 8,
      actor.spot!.y * TOWN_TILE + 13,
    ]);
  }
  settle(actors);
  const spots = updated.actorWorld.buildings.get("host")!.lounge.spots;
  const occupied = new Set<string>();
  for (const actor of actors.actors.values()) {
    expect(actor.spot).not.toBeNull();
    expect(spots).toContainEqual(actor.spot!);
    expect([actor.x, actor.y]).toEqual([
      actor.spot!.x * TOWN_TILE + 8,
      actor.spot!.y * TOWN_TILE + 13,
    ]);
    occupied.add(`${actor.x},${actor.y}`);
  }
  expect(occupied.size).toBe(3);
});

for (const [status, elapsed] of [
  ["blocked", 0.1],
  ["idle", 0.1],
  ["blocked", 0.5],
  ["idle", 0.5],
] as const) {
  test(`${status} agent moves with its building after ${elapsed} seconds`, () => {
    const actors = new TownActors();
    actors.sync(world({ a: "working" }).actorWorld, false);
    const before = world({ a: status });
    actors.sync(before.actorWorld, false);
    actors.step(0.1);
    if (elapsed > 0.1) for (let i = 0; i < 12; i += 1) actors.step(1 / 30);
    const actor = actors.actors.get("a")!;
    expect(actor.mode).toBe(elapsed === 0.1 ? "tween" : "walk");
    const position = [actor.x, actor.y];
    const exit = actor.tween && [actor.tween.x, actor.tween.y];
    const path = actor.path.map(([x, y]) => [x, y]);
    const updated = world({ a: status }, 4, undefined, [], true);
    const oldBuilding = before.actorWorld.buildings.get("host")!;
    const building = updated.actorWorld.buildings.get("host")!;
    const dx = (building.x - oldBuilding.x) * TOWN_TILE;
    const dy = (building.y - oldBuilding.y) * TOWN_TILE;
    expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
    actors.sync(updated.actorWorld, false);
    expect([actor.x, actor.y]).toEqual([position[0]! + dx, position[1]! + dy]);
    if (exit)
      expect([actor.tween!.x, actor.tween!.y]).toEqual([
        exit[0]! + dx,
        exit[1]! + dy,
      ]);
    else expect(actor.path).toEqual(path.map(([x, y]) => [x! + dx, y! + dy]));
    for (let i = 0; i < 2000 && actors.busy; i += 1) {
      actors.step(1 / 30);
      expect(actor.x).toBeGreaterThanOrEqual(building.x * TOWN_TILE);
      expect(actor.x).toBeLessThan((building.x + building.w) * TOWN_TILE);
      expect(actor.y).toBeGreaterThanOrEqual(building.y * TOWN_TILE);
      expect(actor.y).toBeLessThan((building.y + building.h) * TOWN_TILE);
    }
    expect(actors.busy).toBe(false);
    const spot =
      status === "blocked" ? building.queue[actor.queueSlot!]! : actor.spot!;
    expect([actor.x, actor.y]).toEqual([
      spot.x * TOWN_TILE + 8,
      spot.y * TOWN_TILE + 13,
    ]);
  });
}

for (const count of [24, 4]) {
  // The bar is at the bottom of the building, so an idle agent walking there
  // from a large room passes below where a shrunken building ends.
  test(`a bar walker stays on the current floor after 80 desks shrink to ${count}`, () => {
    const actors = new TownActors();
    actors.sync(world({ a: "working" }, 80).actorWorld, false);
    const large = world({ a: "idle" }, 80);
    const small = world({ a: "idle" }, count);
    const building = small.actorWorld.buildings.get("host")!;
    const bottom = (building.y + building.h) * TOWN_TILE;
    actors.sync(large.actorWorld, false);
    for (let i = 0; i < 2000 && actors.actors.get("a")!.y < bottom + 70; i += 1)
      actors.step(1 / 30);
    const actor = actors.actors.get("a")!;
    expect(actor.mode).toBe("walk");
    expect(actor.y).toBeGreaterThan(bottom);
    expect(large.layout.buildings[0]!.x).toBe(building.x);
    expect(large.layout.buildings[0]!.y).toBe(building.y);
    actors.sync(small.actorWorld, false);
    for (let i = 0; i < 60; i += 1) {
      expect(actor.x).toBeGreaterThanOrEqual(building.x * TOWN_TILE);
      expect(actor.x).toBeLessThan((building.x + building.w) * TOWN_TILE);
      expect(actor.y).toBeGreaterThanOrEqual(building.y * TOWN_TILE);
      expect(actor.y).toBeLessThan(bottom);
      actors.step(1 / 30);
    }
    settle(actors);
    const spot = actor.spot!;
    expect(building.lounge.spots).toContainEqual(spot);
    expect([actor.x, actor.y]).toEqual([
      spot.x * TOWN_TILE + 8,
      spot.y * TOWN_TILE + 13,
    ]);
  });
}

test("an agent in the bin walks out of the front door, and back to its desk when put back", () => {
  const { actorWorld, layout } = world({ a: "blocked", b: "working" });
  const actors = new TownActors();
  actors.sync(actorWorld, false);
  const binned = new Set(["a"]);
  actors.sync(actorWorld, false, undefined, undefined, undefined, binned);
  const actor = actors.actors.get("a")!;
  // In the bin it leaves even the reception queue it was waiting in.
  expect(actor.goal).toEqual({ kind: "door" });
  expect(actor.queueSlot).toBeNull();
  expect(actors.busy).toBe(true);
  settle(actors);
  const building = layout.buildings[0]!;
  expect(actor.mode).toBe("out");
  expect(Math.floor(actor.x / TOWN_TILE)).toBe(building.entryX);
  expect(actors.actors.get("b")!.mode).toBe("seat");
  // Put back: it walks in through the door and waits at reception again.
  actors.sync(actorWorld, false, undefined, undefined, undefined, new Set());
  expect(actors.busy).toBe(true);
  settle(actors);
  expect(actor.mode).toBe("stand");
  expect(actor.queueSlot).toBe(0);
});

test("an agent already in the bin when Town opens is out at once", () => {
  const { actorWorld } = world({ a: "working" });
  const actors = new TownActors();
  actors.sync(
    actorWorld,
    false,
    undefined,
    undefined,
    undefined,
    new Set(["a"]),
  );
  expect(actors.actors.get("a")!.mode).toBe("out");
  expect(actors.busy).toBe(false);
});
