import { expect, test } from "bun:test";
import { projectWorldOffice } from "./herdrOfficeProjection";
import { spacesRoom } from "./spacesRooms";
import { spacesRoomsWorld } from "./spacesRooms.fixture";

test("Spaces lists each runtime's rooms and tabs as Town names them (#1430)", () => {
  const world = spacesRoomsWorld();
  const office = projectWorldOffice(world, 0);
  const rooms = world.hosts.flatMap((host) =>
    host.spaces.map((space) => ({
      space,
      room: spacesRoom(host, space, space.children),
    })),
  );

  expect(
    rooms.map(({ room }) => ({
      label: room.label,
      runtime: room.runtime,
      runtimeTag: room.runtimeTag,
      tabs: room.tabs.map((tab) => [tab.label, tab.leaves.length]),
    })),
  ).toEqual([
    {
      label: "Studio",
      runtime: "herdr",
      runtimeTag: "Herdr TUI",
      // A tab holding one named agent reads as that agent, as Town's desk.
      tabs: [
        ["Planner", 1],
        ["Ada", 1],
      ],
    },
    {
      label: "Crew",
      runtime: "herdr-core",
      runtimeTag: "herdr-core",
      // A core tab is a tab of its room, never a room of its own.
      tabs: [
        ["crew-a", 1],
        ["crew-b", 1],
        ["crew-c", 1],
      ],
    },
  ]);

  // The cross-view check: for one World, Spaces' names are Town's.
  for (const { space, room } of rooms) {
    const town = office.rooms.find((each) => each.key === space.id);
    expect(town).toBeDefined();
    expect(room.label).toBe(town!.displayLabel);
    expect(room.tabs.map((tab) => tab.label)).toEqual(
      town!.desks.map((desk) => desk.displayLabel),
    );
  }

  // A tab opens its agent, else its first terminal.
  const [, crew] = rooms;
  expect(crew!.room.tabs.map((tab) => tab.opens?.nativeId)).toEqual([
    "t1",
    "t2",
    "t3",
  ]);
});

test("a room's tab lists only its shown terminals but is named from all", () => {
  const world = spacesRoomsWorld();
  const host = world.hosts.find((each) => each.connectionId === "tui")!;
  const space = host.spaces[0]!;
  const room = spacesRoom(host, space, []);
  expect(room.tabs.map((tab) => [tab.label, tab.leaves.length])).toEqual([
    ["Planner", 0],
    ["Ada", 0],
  ]);
  expect(room.tabs[1]!.opens?.nativeId).toBe("w1:p2");
  expect(room.untabbed).toEqual([]);
});
