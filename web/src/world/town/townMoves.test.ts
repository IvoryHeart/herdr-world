import { expect, test } from "bun:test";
import { bridge } from "../../api";
import { moveTabInList } from "../../tabReorder";
import type { OfficeDesk, OfficeRoom } from "../herdrOfficeProjection";
import {
  deskReorderIndex,
  requestDeskReorder,
  requestRoomMove,
  townMoveNotice,
  townMoveResult,
} from "./townMoves";

const pane = (tab: string, n: number) => ({
  terminal_id: `term-${n}`,
  pane_id: `p${n}`,
  tab_id: tab,
});

test("a move confirmed back reads as not moved and springs home", () => {
  const outcome = {
    status: "failed" as const,
    message: "Moving the desk failed: rejected The desk was moved back.",
    rolled_back: true,
    topology: [pane("t1", 1), pane("t1", 2)],
  };
  expect(townMoveResult(outcome)).toBe("returned");
  expect(townMoveNotice("Desk", outcome, "t1")).toStartWith("Desk not moved:");
});

test("a partial move says how many panes left, never that nothing moved", () => {
  const outcome = {
    status: "failed" as const,
    message: "Some panes could not be moved back.",
    rolled_back: false,
    topology_known: true,
    topology: [pane("t1", 1), pane("t9", 2), pane("t9", 3)],
  };
  expect(townMoveResult(outcome)).toBe("uncertain");
  const notice = townMoveNotice("Desk", outcome, "t1");
  expect(notice).toContain("only partly moved: 2 of 3 panes");
  expect(notice).not.toContain("not moved");
});

test("unknown pane locations ask the user to check both rooms", () => {
  const outcome = {
    status: "failed" as const,
    message: "Where its panes are now could not be read.",
    rolled_back: false,
    topology_known: false,
    topology: [],
  };
  expect(townMoveResult(outcome)).toBe("uncertain");
  expect(townMoveNotice("Desk", outcome, "t1")).toContain("Check both rooms");
});

const order = ["a", "b", "c", "d"];

/** Herdr's order after tab.move, as Spaces applies it locally. */
const after = (tabId: string, insertIndex: number) =>
  moveTabInList(
    order.map((tab_id) => ({ tab_id, workspace_id: "w" })),
    tabId,
    insertIndex,
  ).map(({ tab_id }) => tab_id);

test("a desk dropped on another takes that desk's slot", () => {
  // Forward: lands after the desk it was dropped on.
  expect(after("a", deskReorderIndex(order, "a", "c")!)).toEqual([
    "b",
    "c",
    "a",
    "d",
  ]);
  // Backward: lands before it.
  expect(after("d", deskReorderIndex(order, "d", "b")!)).toEqual([
    "a",
    "d",
    "b",
    "c",
  ]);
  expect(after("b", deskReorderIndex(order, "b", "a")!)).toEqual([
    "b",
    "a",
    "c",
    "d",
  ]);
});

test("a desk sent last goes after every tab, hidden ones included", () => {
  expect(after("b", deskReorderIndex(order, "b", null)!)).toEqual([
    "a",
    "c",
    "d",
    "b",
  ]);
  expect(deskReorderIndex(order, "d", null)).toBeNull();
});

test("a desk or target that left the room is refused", () => {
  expect(deskReorderIndex(order, "a", "x")).toBeUndefined();
  expect(deskReorderIndex(order, "x", "a")).toBeUndefined();
});

test("an old Herdr host is refused in plain words, before any tab.move", async () => {
  const calls: string[] = [];
  const connection = bridge.connection;
  bridge.connection = ((connectionId: string, generation: number) => ({
    connectionId,
    generation,
    serverRuntimeGeneration: generation,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string) => {
      calls.push(method);
      return { tabs: [], tab_move_supported: false };
    },
  })) as unknown as typeof bridge.connection;
  const desk = (tab: string) =>
    ({
      key: tab,
      roomKey: "room",
      tabRef: { connectionId: "old", generation: 2, nativeId: tab },
    }) as unknown as OfficeDesk;
  try {
    const outcome = await requestDeskReorder(desk("t1"), desk("t2"));
    expect(outcome).toMatchObject({
      status: "refused",
      message:
        "This host's Herdr cannot reorder tabs. Herdr 0.7.2 or later can.",
    });
    expect(calls).toEqual(["tab.list"]);
  } finally {
    bridge.connection = connection;
  }
});

const room = (workspace: string, connectionId = "local", generation = 3) =>
  ({
    key: `room:${workspace}`,
    displayLabel: workspace,
    workspaceRef: { connectionId, generation, nativeId: workspace },
  }) as unknown as OfficeRoom;

test("a room takes another room's place through Herdr's workspace order", async () => {
  const calls: [string, unknown][] = [];
  const connection = bridge.connection;
  bridge.connection = ((connectionId: string, generation: number) => ({
    connectionId,
    generation,
    serverRuntimeGeneration: generation,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: unknown) => {
      calls.push([method, params]);
      if (method === "workspace.list")
        // Listed out of order: Herdr's order is the workspace number.
        return {
          workspaces: [
            { workspace_id: "w3", number: 3 },
            { workspace_id: "w1", number: 1 },
            { workspace_id: "w4", number: 4 },
            { workspace_id: "w2", number: 2 },
          ],
        };
      return { type: "ok" };
    },
  })) as unknown as typeof bridge.connection;
  try {
    // w4 into w2's place: before w2 (Herdr inserts before index 1).
    expect(await requestRoomMove(room("w4"), room("w2"))).toEqual({
      status: "moved",
    });
    expect(calls[calls.length - 1]).toEqual([
      "workspace.move",
      { workspace_id: "w4", insert_index: 1 },
    ]);
    // w1 into w3's place: after w3 (index 3, counted before removal).
    await requestRoomMove(room("w1"), room("w3"));
    expect(calls[calls.length - 1]).toEqual([
      "workspace.move",
      { workspace_id: "w1", insert_index: 3 },
    ]);
    // A room Herdr no longer lists is refused, with nothing moved.
    calls.length = 0;
    expect(await requestRoomMove(room("w9"), room("w2"))).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(calls.map(([method]) => method)).toEqual(["workspace.list"]);
    // Another host's building: refused before asking any host.
    calls.length = 0;
    expect(
      await requestRoomMove(room("w1"), room("w2", "remote")),
    ).toMatchObject({ status: "refused", reason: "other_host" });
    expect(calls).toEqual([]);
  } finally {
    bridge.connection = connection;
  }
});
