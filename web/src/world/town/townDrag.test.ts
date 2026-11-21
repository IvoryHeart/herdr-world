import { expect, test } from "bun:test";
import {
  TOWN_PINNED_HINT,
  townDragFor,
  townDropTarget,
  townMagnetDesk,
  townRoomDrag,
  townRoomDropTarget,
} from "./townDrag";
import { layoutTown, TOWN_SHAPES, TOWN_TILE } from "./townLayout";
import { townRoomSpotAt } from "./townRoomPlace";
import type { TownModel } from "./townModel";

/** Two hosts: host a has rooms r1 (desks d1, d2) and r2 (d3); host b has r3 (d4). */
function model(pinned: string[] = []) {
  const desk = (key: string, hostKey: string, roomKey: string) => [
    key,
    {
      key,
      hostKey,
      roomKey,
      displayLabel: key,
      canOpenInSpaces: true,
      tabRef: { connectionId: hostKey },
      paneDevices: [],
    },
  ];
  const room = (
    key: string,
    hostKey: string,
    desks: string[],
    omittedDeskCount = 0,
  ) => [
    key,
    {
      key,
      hostKey,
      displayLabel: key.toUpperCase(),
      desks: desks.map((deskKey) => ({ key: deskKey })),
      omittedDeskCount,
      canOpenInSpaces: true,
      stale: false,
      workspaceRef: { connectionId: hostKey },
    },
  ];
  return {
    rooms: new Map([
      room("r1", "a", ["d1", "d2"]),
      room("r2", "a", ["d3"]),
      room("r3", "b", ["d4"]),
    ] as never),
    desks: new Map([
      desk("d1", "a", "r1"),
      desk("d2", "a", "r1"),
      desk("d3", "a", "r2"),
      desk("d4", "b", "r3"),
    ] as never),
    agents: new Map([
      [
        "ag",
        {
          key: "ag",
          hostKey: "a",
          roomKey: "r1",
          displayLabel: "claude",
          canOpenInSpaces: true,
          stale: false,
        },
      ],
    ] as never),
    agentSeats: new Map([["ag", { deskKey: "d1", seat: 0 }]]),
    deskPins: new Map(
      pinned.map((key) => [key, { key: `pin:${key}`, rank: null }]),
    ),
  } as unknown as TownModel;
}

test("a held press picks up a desk from the room-card zoom in, an agent only zoomed in", () => {
  const m = model();
  // Roofs: nothing lifts.
  expect(townDragFor({ kind: "desk", key: "d1" }, m, "town")).toBeNull();
  // Room cards: desks are finger-sized, so a desk lifts; agents wait for room zoom.
  expect(townDragFor({ kind: "desk", key: "d1" }, m, "overview")).toMatchObject(
    { kind: "desk", key: "d1", from: "r1" },
  );
  expect(townDragFor({ kind: "agent", key: "ag" }, m, "overview")).toBeNull();
  // A pinned desk lifts too: it moves among its room's pinned seats.
  expect(
    townDragFor({ kind: "desk", key: "d1" }, model(["d1"]), "overview"),
  ).toMatchObject({ kind: "desk", key: "d1", from: "r1" });
  expect(townDragFor({ kind: "desk", key: "d1" }, m, "room")).toMatchObject({
    kind: "desk",
    key: "d1",
    from: "r1",
  });
  expect(
    townDragFor({ kind: "pane", key: "p", deskKey: "d2" }, m, "desk"),
  ).toMatchObject({ kind: "desk", key: "d2" });
  expect(townDragFor({ kind: "agent", key: "ag" }, m, "desk")).toMatchObject({
    kind: "agent",
    key: "ag",
    from: "d1",
  });
  expect(townDragFor({ kind: "room", key: "r1" }, m, "desk")).toBeNull();
});

test("a desk lands on another room of its host, never its own or another host's", () => {
  const m = model();
  const drag = townDragFor({ kind: "desk", key: "d1" }, m, "room")!;
  expect(townDropTarget(drag, { kind: "room", key: "r2" }, m)).toMatchObject({
    key: "r2",
    action: "move",
  });
  // Dropping at once on a desk means that desk's room.
  expect(townDropTarget(drag, { kind: "desk", key: "d3" }, m).key).toBe("r2");
  // Its own room's floor: nothing, while it is in no team.
  expect(townDropTarget(drag, { kind: "room", key: "r1" }, m).key).toBeNull();
  // Its own desk is neither a slot nor a teammate.
  expect(townDropTarget(drag, { kind: "desk", key: "d1" }, m).key).toBeNull();
  // Another runtime's room takes only a desk with one terminal.
  expect(townDropTarget(drag, { kind: "room", key: "r3" }, m)).toMatchObject({
    key: null,
    label: "Only a desk with one terminal moves to another runtime",
  });
  expect(townDropTarget(drag, null, m).key).toBeNull();
  const d1 = m.desks.get("d1")! as unknown as Record<string, unknown>;
  Object.assign(d1, {
    observedPaneCount: 1,
    paneDevices: [{ agentKey: "ag" }],
  });
  expect(townDropTarget(drag, { kind: "room", key: "r3" }, m)).toMatchObject({
    key: "r3",
    action: "move",
  });
  // Pinned, it may still go to another runtime, where it stays pinned.
  const pinned = model(["d1"]);
  Object.assign(pinned.desks.get("d1")!, d1);
  expect(
    townDropTarget(drag, { kind: "room", key: "r3" }, pinned),
  ).toMatchObject({ key: "r3", action: "move" });
});

test("an agent lands on another desk of its host", () => {
  const m = model();
  const drag = townDragFor({ kind: "agent", key: "ag" }, m, "desk")!;
  expect(townDropTarget(drag, { kind: "desk", key: "d3" }, m).key).toBe("d3");
  expect(townDropTarget(drag, { kind: "desk", key: "d1" }, m).key).toBeNull();
  expect(townDropTarget(drag, { kind: "desk", key: "d4" }, m).key).toBeNull();
});

test("a desk resting on another desk snaps to it and groups, in any room of its host", () => {
  const m = model();
  const drag = townDragFor({ kind: "desk", key: "d1" }, m, "room")!;
  expect(townMagnetDesk(drag, { kind: "desk", key: "d2" }, m)).toBe("d2");
  expect(townMagnetDesk(drag, { kind: "desk", key: "d1" }, m)).toBeNull();
  expect(townMagnetDesk(drag, { kind: "room", key: "r1" }, m)).toBeNull();
  const teams = new Map<string, string>();
  expect(
    townDropTarget(drag, { kind: "desk", key: "d2" }, m, teams, "d2"),
  ).toMatchObject({ key: "d2", action: "group", label: "Group with d2" });
  // On a seat or an agent at that desk, too; across rooms the desk moves.
  expect(
    townDropTarget(
      drag,
      { kind: "pane", key: "p", deskKey: "d3" },
      m,
      teams,
      "d3",
    ),
  ).toMatchObject({ key: "d3", action: "group" });
  // The magnet holds only while the pointer stays on that desk.
  expect(
    townDropTarget(drag, { kind: "room", key: "r2" }, m, teams, "d3"),
  ).toMatchObject({ key: "r2", action: "move" });
  expect(
    townDropTarget(drag, { kind: "desk", key: "d4" }, m, teams, "d4"),
  ).toMatchObject({ key: null, label: "Desks group only within one host" });
});

test("a grouped desk leaves its team on its own floor; teammates do not regroup", () => {
  const m = model();
  const teams = new Map([
    ["d1", "d1"],
    ["d2", "d1"],
  ]);
  const drag = townDragFor({ kind: "desk", key: "d1" }, m, "room")!;
  // Only a manual group can be left; a spawn is Herdr's record, not a choice.
  expect(
    townDropTarget(drag, { kind: "room", key: "r1" }, m, teams),
  ).toMatchObject({ key: null });
  expect(
    townDropTarget(
      drag,
      { kind: "room", key: "r1" },
      m,
      teams,
      null,
      new Set(["d1"]),
    ),
  ).toMatchObject({ key: "r1", action: "ungroup", label: "Leave the team" });
  expect(
    townDropTarget(drag, { kind: "desk", key: "d2" }, m, teams, "d2"),
  ).toMatchObject({ key: null, label: "Move d1: already in this team" });
  expect(
    townDropTarget(drag, { kind: "desk", key: "d3" }, m, teams, "d3"),
  ).toMatchObject({ key: "d3", action: "group" });
});

test("a desk dropped in its own room is reordered, as a tab in Spaces", () => {
  const m = model();
  const drag = townDragFor({ kind: "desk", key: "d1" }, m, "room")!;
  // Onto another desk: take its slot.
  expect(townDropTarget(drag, { kind: "desk", key: "d2" }, m)).toMatchObject({
    key: "d2",
    action: "reorder",
  });
  expect(townDropTarget(drag, { kind: "agent", key: "ag" }, m).key).toBeNull();
  // Onto the free spot: go last.
  const cell = { kind: "cell", roomKey: "r1", cellIndex: 2 } as const;
  expect(townDropTarget(drag, cell, m)).toMatchObject({
    key: "r1",
    action: "reorder",
  });
  expect(townDropTarget(drag, { kind: "room", key: "r1" }, m).key).toBeNull();
  // Already last: nothing to do.
  const lastDrag = townDragFor({ kind: "desk", key: "d2" }, m, "room")!;
  expect(townDropTarget(lastDrag, cell, m).key).toBeNull();
  // With hidden desks, the free spot is the last drawn desk's place, so the
  // desk stays in view; the last drawn desk itself stays put.
  (m.rooms.get("r1") as { omittedDeskCount: number }).omittedDeskCount = 3;
  expect(townDropTarget(drag, cell, m)).toMatchObject({
    key: "d2",
    action: "reorder",
  });
  expect(townDropTarget(lastDrag, cell, m).key).toBeNull();
});

test("a standing agent does not stand for its desk's slot", () => {
  const m = model();
  const drag = townDragFor({ kind: "desk", key: "d2" }, m, "room")!;
  // ag sits at d1: a seated hit is d1's slot, a lounge or queue hit is not.
  expect(townDropTarget(drag, { kind: "agent", key: "ag" }, m)).toMatchObject({
    key: "d1",
    action: "reorder",
  });
  expect(
    townDropTarget(drag, { kind: "agent", key: "ag", standing: true }, m).key,
  ).toBeNull();
});

test("an unpinned desk takes no pinned seat", () => {
  const m = model(["d2"]);
  // Its agents can still be moved; the pin is the desk's.
  expect(
    townDragFor({ kind: "agent", key: "ag" }, model(["d1"]), "desk"),
  ).not.toBeNull();
  const drag = townDragFor({ kind: "desk", key: "d1" }, m, "room")!;
  expect(townDropTarget(drag, { kind: "desk", key: "d2" }, m)).toMatchObject({
    key: null,
    label: "d2 is pinned: unpin it to take its place",
  });
});

test("a pinned desk reorders among its room's pinned seats and goes back from anywhere else", () => {
  const m = model(["d1", "d2"]);
  const drag = townDragFor({ kind: "desk", key: "d2" }, m, "room")!;
  // Onto another pinned desk of its room, or its seated agent: take its place.
  for (const hit of [
    { kind: "desk", key: "d1" },
    { kind: "pane", key: "p", deskKey: "d1" },
    { kind: "agent", key: "ag" },
  ] as const)
    expect(townDropTarget(drag, hit, m)).toMatchObject({
      key: "d1",
      label: "Put d2 in d1’s place",
      action: "reorder",
    });
  // Off the rug, in another room or host, on nothing: back, with the hint.
  for (const hit of [
    { kind: "cell", roomKey: "r1", cellIndex: 2 },
    { kind: "room", key: "r1" },
    { kind: "room", key: "r2" },
    { kind: "desk", key: "d3" },
    { kind: "room", key: "r3" },
    { kind: "desk", key: "d2" },
    null,
  ] as const)
    expect(townDropTarget(drag, hit, m)).toEqual({
      key: null,
      label: TOWN_PINNED_HINT,
    });
  // An unpinned desk of its room is not a pinned seat.
  const one = model(["d2"]);
  expect(
    townDropTarget(
      townDragFor({ kind: "desk", key: "d2" }, one, "room")!,
      { kind: "desk", key: "d1" },
      one,
    ),
  ).toEqual({ key: null, label: TOWN_PINNED_HINT });
  // Resting on a desk in another room does not group it there.
  expect(
    townDropTarget(drag, { kind: "desk", key: "d3" }, m, new Map(), "d3"),
  ).toEqual({ key: null, label: TOWN_PINNED_HINT });
  // In its own room it still groups, and leaves a team on the floor.
  expect(
    townDropTarget(drag, { kind: "desk", key: "d1" }, m, new Map(), "d1"),
  ).toMatchObject({ key: "d1", action: "group" });
  expect(
    townDropTarget(
      drag,
      { kind: "room", key: "r1" },
      m,
      new Map(),
      null,
      new Set(["d2"]),
    ),
  ).toMatchObject({ key: "r1", action: "ungroup" });
});

test("a room lifts by its edge, never its floor, and not from the roofs", () => {
  const m = model();
  expect(
    townDragFor({ kind: "room", key: "r1", edge: true }, m, "room"),
  ).toMatchObject({ kind: "room", key: "r1", hostKey: "a", from: "r1" });
  expect(
    townDragFor({ kind: "room", key: "r1", edge: true }, m, "overview"),
  ).toMatchObject({ kind: "room", key: "r1" });
  expect(townDragFor({ kind: "room", key: "r1" }, m, "room")).toBeNull();
  expect(
    townDragFor({ kind: "room", key: "r1", edge: true }, m, "town"),
  ).toBeNull();
  // Alone in its building, it has nowhere to go.
  expect(
    townDragFor({ kind: "room", key: "r3", edge: true }, m, "room"),
  ).toBeNull();
  // A stale room stays where it is.
  const stale = model();
  (stale.rooms.get("r1") as { stale: boolean }).stale = true;
  expect(townRoomDrag("r1", stale)).toBeNull();
});

test("a room goes anywhere in its own building, never another host's", () => {
  const m = model();
  const { layout } = layoutTown(
    {
      hosts: [
        { key: "a", displayOrder: 0 },
        { key: "b", displayOrder: 1 },
      ],
      rooms: [
        { key: "r1", hostKey: "a", order: 0, deskKeys: ["d1", "d2"] },
        { key: "r2", hostKey: "a", order: 1, deskKeys: ["d3"] },
        { key: "r3", hostKey: "b", order: 0, deskKeys: ["d4"] },
      ],
    },
    TOWN_SHAPES.wide,
  );
  const drag = townRoomDrag("r1", m)!;
  const [a, b] = layout.buildings;
  const r1 = a!.rooms.find((room) => room.key === "r1")!;
  const T = TOWN_TILE;
  // Its top-left at tile (x, y), the pointer at (px, py).
  const aim = (x: number, y: number, px = x, py = y) =>
    townRoomDropTarget(drag, layout, m, x * T, y * T, px * T, py * T);
  // Across: host a's floor is only as tall as its rooms.
  const across = aim(r1.x + 3, r1.y);
  expect(across.target).toMatchObject({
    key: "r1",
    label: "Move R1 here",
    action: "move",
  });
  // Whole tiles, kept inside the building's walls (townRoomSpotAt).
  expect(across.placement!.spots.get("r1")).toEqual(
    townRoomSpotAt(layout, "r1", r1.x + 3, r1.y)!,
  );
  expect(across.placement!.spots.get("r1")!.x).toBeGreaterThan(r1.x - a!.x);
  // Back on its own spot: it goes back.
  expect(aim(r1.x, r1.y).target.key).toBeNull();
  expect(aim(r1.x, r1.y).placement).toBeNull();
  // The pointer over another host's building: it goes back.
  expect(aim(r1.x, r1.y + 3, b!.x + 4, b!.y + 12).target).toMatchObject({
    key: null,
    label: "Rooms stay in their own host’s building",
  });
  // Over the street, it stays inside its own building's walls.
  const far = aim(r1.x + 3, r1.y + 999);
  expect(far.placement!.rooms.get("r1")!.y).toBeLessThan(
    a!.y + a!.h + r1.h + 20,
  );
});
