import { expect, test } from "bun:test";
import { terminalColorKey } from "../terminalColor";
import { townMoveMenu, type TownMoveMenuDeps } from "./townMoveMenu";
import { townPinnedReorder, townRoomPinnedSeats } from "./townPinOrder";

const desk = (key: string) => ({
  key,
  hostKey: "studio",
  roomKey: "r1",
  displayLabel: key,
  tabRef: { connectionId: "studio", nativeId: key },
});
const DESKS = ["t1", "t2", "t3", "t4"].map(desk);
const ROOM = {
  key: "r1",
  hostKey: "studio",
  displayLabel: "Room",
  desks: DESKS,
  omittedDeskCount: 0,
  workspaceRef: { connectionId: "studio", nativeId: "w1" },
};
const OFFICE = {
  rooms: [ROOM],
  deskRoster: DESKS.map((entry) => ({ desk: entry })),
} as never;
const pinKey = (tabId: string) =>
  terminalColorKey({
    connectionId: "studio",
    workspaceId: "w1",
    tabId,
    workspaceIds: new Set(["w1"]),
  });
/** Pins by tab, each with its saved place (null: none). */
const pins = (entries: [string, number | null][]) =>
  Object.fromEntries(
    entries.map(([tab, rank]) => [
      pinKey(tab),
      rank === null ? { cell: null } : { cell: null, rank },
    ]),
  );

test("a room's pinned desks are in their saved order, then tab order", () => {
  const seats = townRoomPinnedSeats(
    OFFICE,
    ROOM as never,
    pins([
      ["t4", null],
      ["t2", 1],
      ["t3", 0],
    ]),
  );
  expect(seats).toEqual([
    { deskKey: "t3", pinKey: pinKey("t3") },
    { deskKey: "t2", pinKey: pinKey("t2") },
    { deskKey: "t4", pinKey: pinKey("t4") },
  ]);
});

test("a pinned desk dropped on another takes its place; two desks swap", () => {
  const seats = ["a", "b", "c"].map((deskKey) => ({ deskKey }));
  const keys = (next: { deskKey: string }[] | null) =>
    next?.map((seat) => seat.deskKey) ?? null;
  expect(keys(townPinnedReorder(seats, "c", "a"))).toEqual(["c", "a", "b"]);
  expect(keys(townPinnedReorder(seats, "a", "c"))).toEqual(["b", "c", "a"]);
  expect(keys(townPinnedReorder(seats.slice(0, 2), "b", "a"))).toEqual([
    "b",
    "a",
  ]);
  expect(townPinnedReorder(seats, "a", "a")).toBeNull();
  expect(townPinnedReorder(seats, "a", "z")).toBeNull();
});

test("the keyboard move of a pinned desk offers only pinned places; others offer none of them", () => {
  const reorders: [string, string | null][] = [];
  const pinned = ["t3", "t1"];
  const deps = {
    office: OFFICE,
    deskForKey: (key: string) => DESKS.find((entry) => entry.key === key),
    roomForKey: () => ROOM,
    agentOf: () => undefined,
    pinnedSeats: () => pinned,
    close: () => {},
    runDeskReorder: async (deskKey: string, ontoKey: string | null) => {
      reorders.push([deskKey, ontoKey]);
    },
    runDeskMove: async () => "moved" as const,
    runAgentMove: async () => {},
    teams: { teamEntries: () => [] },
  } as unknown as TownMoveMenuDeps;
  const own = townMoveMenu({ step: "room", deskKey: "t1" }, deps);
  expect(own.entries.map((entry) => entry.key)).toEqual(["t3"]);
  expect(own.detail).toContain("Unpin to move it out of the front row");
  own.entries[0]!.onChoose();
  expect(reorders).toEqual([["t1", "t3"]]);
  const other = townMoveMenu({ step: "room", deskKey: "t2" }, deps);
  expect(other.entries.map((entry) => entry.key)).toEqual(["t4", "t2:last"]);
});

test("the keyboard move of a pinned core desk offers other core rooms; it stays pinned there", () => {
  // A desk moved in from Herdr TUI arrives pinned (agent-move.ts); it can
  // still go to another core room, or back to another runtime.
  const core = { connectionId: "core" };
  const coreDesk = (key: string, roomKey: string) => ({
    ...desk(key),
    roomKey,
    coreOpen: core,
    observedPaneCount: 1,
    paneDevices: [{}],
    tabRef: { connectionId: "core", nativeId: key },
  });
  const coreRoom = (key: string, desks: unknown[]) => ({
    ...ROOM,
    key,
    displayLabel: key,
    desks,
    stale: false,
    coreOpen: core,
    observedDeskCount: desks.length,
    workspaceRef: { connectionId: "core", nativeId: key },
  });
  const moved = coreDesk("c1", "core-a");
  const rooms = [
    coreRoom("core-a", [moved]),
    coreRoom("core-b", [coreDesk("c2", "core-b")]),
    { ...ROOM, stale: false, canOpenInSpaces: true, observedDeskCount: 4 },
  ];
  const moves: [string, string][] = [];
  const deps = {
    office: { rooms, hosts: [] },
    deskForKey: () => moved,
    roomForKey: (key: string) => rooms.find((room) => room.key === key),
    agentOf: () => undefined,
    pinnedSeats: () => ["c1"],
    close: () => {},
    runDeskReorder: async () => {},
    runDeskMove: async (deskKey: string, roomKey: string) => {
      moves.push([deskKey, roomKey]);
      return "moved" as const;
    },
    runAgentMove: async () => {},
    teams: { teamEntries: () => [] },
  } as unknown as TownMoveMenuDeps;
  const menu = townMoveMenu({ step: "room", deskKey: "c1" }, deps);
  expect(menu.entries.map((entry) => entry.key)).toEqual(["core-b", "r1"]);
  expect(menu.detail).toBe("Choose a room: it stays pinned there.");
  menu.entries[0]!.onChoose();
  expect(moves).toEqual([["c1", "core-b"]]);
});
