import { expect, test } from "bun:test";
import { townDragFor, townDropTarget, townMagnetDesk } from "./townDrag";
import type { TownModel } from "./townModel";

/** Two hosts: host a has rooms r1 (desks d1, d2) and r2 (d3); host b has r3 (d4). */
function model() {
  const desk = (key: string, hostKey: string, roomKey: string) => [
    key,
    { key, hostKey, roomKey, displayLabel: key, canOpenInSpaces: true },
  ];
  const room = (key: string, hostKey: string) => [
    key,
    { key, hostKey, displayLabel: key.toUpperCase() },
  ];
  return {
    rooms: new Map([
      room("r1", "a"),
      room("r2", "a"),
      room("r3", "b"),
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
    action: "move",
  });
  // Dropping at once on a desk means that desk's room.
  expect(townDropTarget(drag, { kind: "desk", key: "d3" }, m).key).toBe("r2");
  expect(townDropTarget(drag, { kind: "desk", key: "d2" }, m).key).toBeNull();
  // Its own room's floor: nothing, while it is in no team.
  expect(townDropTarget(drag, { kind: "room", key: "r1" }, m).key).toBeNull();
  // Its own desk is not a teammate.
  expect(townDropTarget(drag, { kind: "desk", key: "d1" }, m).key).toBeNull();
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
