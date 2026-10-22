import { expect, test } from "bun:test";
import { townDragFor, townDropTarget } from "./townDrag";
import type { TownModel } from "./townModel";

/** Two hosts: host a has rooms r1 (desks d1, d2) and r2 (d3); host b has r3 (d4). */
function model() {
  const desk = (key: string, hostKey: string, roomKey: string) => [
    key,
    { key, hostKey, roomKey, displayLabel: key, canOpenInSpaces: true },
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
  } as unknown as TownModel;
}

test("a held press picks up a desk or a seated agent only when zoomed in", () => {
  const m = model();
  expect(townDragFor({ kind: "desk", key: "d1" }, m, "overview")).toBeNull();
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
  });
  // Dropping on a desk means that desk's room.
  expect(townDropTarget(drag, { kind: "desk", key: "d3" }, m).key).toBe("r2");
  expect(townDropTarget(drag, { kind: "room", key: "r3" }, m)).toMatchObject({
    key: null,
    label: "Desks move only within one host",
  });
  expect(townDropTarget(drag, null, m).key).toBeNull();
});

test("an agent lands on another desk of its host", () => {
  const m = model();
  const drag = townDragFor({ kind: "agent", key: "ag" }, m, "desk")!;
  expect(townDropTarget(drag, { kind: "desk", key: "d3" }, m).key).toBe("d3");
  expect(townDropTarget(drag, { kind: "desk", key: "d1" }, m).key).toBeNull();
  expect(townDropTarget(drag, { kind: "desk", key: "d4" }, m).key).toBeNull();
});

test("a desk dropped in its own room is reordered, as a tab in Spaces", () => {
  const m = model();
  const drag = townDragFor({ kind: "desk", key: "d1" }, m, "room")!;
  // Onto another desk: take its slot.
  expect(townDropTarget(drag, { kind: "desk", key: "d2" }, m)).toMatchObject({
    key: "d2",
    reorder: true,
  });
  expect(townDropTarget(drag, { kind: "agent", key: "ag" }, m).key).toBeNull();
  // Onto the free spot: go last.
  const cell = { kind: "cell", roomKey: "r1", cellIndex: 2 } as const;
  expect(townDropTarget(drag, cell, m)).toMatchObject({
    key: "r1",
    reorder: true,
  });
  expect(townDropTarget(drag, { kind: "room", key: "r1" }, m).key).toBeNull();
  // Already last, and no hidden desks after it: nothing to do.
  const lastDrag = townDragFor({ kind: "desk", key: "d2" }, m, "room")!;
  expect(townDropTarget(lastDrag, cell, m).key).toBeNull();
  (m.rooms.get("r1") as { omittedDeskCount: number }).omittedDeskCount = 3;
  expect(townDropTarget(lastDrag, cell, m).key).toBe("r1");
});
