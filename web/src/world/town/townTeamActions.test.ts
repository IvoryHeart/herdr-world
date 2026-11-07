import { beforeEach, expect, test } from "bun:test";
import { townTeamActions } from "./townTeamActions";
import { terminalColorKey } from "../terminalColor";
import type { TownJoinRequest } from "./townJoinSeats";

const grouped: unknown[][] = [];
const seated: TownJoinRequest[] = [];

const desk = (key: string, roomKey: string) => ({
  key,
  hostKey: "studio",
  roomKey,
  displayLabel: key,
  tabRef: { connectionId: "studio", nativeId: key },
});
const DESKS = [desk("t1", "r1"), desk("t2", "r1"), desk("t3", "r2")];

function setup(pinned: string[]) {
  const toasts: string[] = [];
  const moves: string[] = [];
  const actions = townTeamActions({
    world: {
      hosts: [
        {
          connectionId: "studio",
          spaces: [
            {
              children: DESKS.map((entry) => ({
                tabId: entry.key,
                terminalId: `term_${entry.key}`,
                kind: "agent",
              })),
            },
          ],
        },
      ],
    } as never,
    office: {
      deskRoster: DESKS.map((entry) => ({ desk: entry })),
      rooms: ["r1", "r2"].map((key) => ({
        key,
        workspaceRef: { connectionId: "studio", nativeId: `w-${key}` },
      })),
    } as never,
    // Pins are keyed like the desk's colour (terminalColorKey).
    deskPins: Object.fromEntries(
      pinned.map((key) => [
        terminalColorKey({
          connectionId: "studio",
          tabId: key,
          workspaceIds: new Set(["w-r1", "w-r2"]),
        } as never),
        { cell: null },
      ]),
    ) as never,
    relations: [],
    movingKey: null,
    deskForKey: (key) =>
      (DESKS.find((entry) => entry.key === key) as never) ?? null,
    roomForKey: (key) => ({ key, observedDeskCount: 2 }) as never,
    toast: (_kind, text) => toasts.push(text),
    confirm: () => {},
    runDeskMove: async (deskKey, roomKey, _allowCloseRoom, then) => {
      moves.push(`${deskKey}->${roomKey}`);
      await then?.("moved");
      return "returned";
    },
    closeMenu: () => {},
    openGroupMenu: () => {},
    seatJoin: (request) => seated.push(request),
    io: {
      groupTerminals: async (...args: unknown[]) => {
        grouped.push(args);
        return null;
      },
      ungroupTerminals: async () => null,
    },
  });
  return { actions, toasts, moves };
}

beforeEach(() => {
  grouped.length = 0;
  seated.length = 0;
});

test("a pinned desk never leaves its room to join a team", async () => {
  const { actions, toasts, moves } = setup(["t1"]);
  await actions.runGroupDesk("t1", "t3");
  expect(grouped).toEqual([]);
  expect(moves).toEqual([]);
  expect(toasts[0]).toContain("is pinned");
});

test("a pinned desk joins a team in its room and keeps its place", async () => {
  const { actions, moves } = setup(["t1"]);
  await actions.runGroupDesk("t1", "t2");
  expect(grouped.length).toBe(1);
  expect(moves).toEqual([]);
  expect(seated).toEqual([]);
});

test("an unpinned desk is seated beside its new teammate, tab order untouched", async () => {
  const { actions, moves } = setup([]);
  await actions.runGroupDesk("t1", "t2");
  expect(grouped.length).toBe(1);
  expect(moves).toEqual([]);
  expect(seated).toEqual([
    { deskKey: "t1", targetKey: "t2", fromDeskKey: "t1", fromRoomKey: "r1" },
  ]);
});

test("a desk from another room is seated under its new tab's key", async () => {
  const { actions, moves } = setup([]);
  await actions.runGroupDesk("t3", "t1");
  expect(moves).toEqual(["t3->r1"]);
  expect(seated).toEqual([
    {
      deskKey: JSON.stringify(["studio", "tab", "moved"]),
      targetKey: "t1",
      fromDeskKey: "t3",
      fromRoomKey: "r2",
    },
  ]);
});
