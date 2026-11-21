import { expect, test } from "bun:test";
import { bridge } from "../../api";
import type { OfficeDesk, OfficeRoom } from "../herdrOfficeProjection";
import { requestDeskMove } from "./townMoves";
import { canMoveDeskToRoom } from "./townMoveEligibility";

const room = (connectionId: string, core = false) =>
  ({
    key: `${connectionId}-room`,
    stale: false,
    canOpenInSpaces: !core,
    ...(core ? { coreOpen: true } : {}),
    workspaceRef: { connectionId, nativeId: "room", generation: 3 },
  }) as OfficeRoom;
const desk = (connectionId: string, core = false) =>
  ({
    stale: false,
    canOpenInSpaces: !core,
    ...(core ? { coreOpen: true } : {}),
    observedPaneCount: 1,
    tabRef: { connectionId, nativeId: "tab", generation: 3 },
    paneDevices: [
      {
        agentKey: "agent",
        paneRef: { nativeId: "pane" },
        terminalRef: { nativeId: "terminal" },
      },
    ],
  }) as OfficeDesk;

test("TUI/core and same-core room drops use the exact witnessed handoff route", async () => {
  const original = bridge.call;
  try {
    for (const [source, destination] of [
      [desk("tui"), room("core-local", true)],
      [desk("core-local", true), room("tui")],
      [desk("core-local", true), room("core-local", true)],
    ] as const) {
      const sent: unknown[] = [];
      bridge.call = (async (...args: unknown[]) => {
        sent.push(args);
        return {
          status: "moved",
          target: { tab_id: "new-tab", workspace_id: "room" },
        };
      }) as typeof bridge.call;
      expect(
        await requestDeskMove(source, destination, true, false, {
          room: room(source.tabRef.connectionId),
          workspaceIds: ["room"],
        }),
      ).toEqual({ status: "moved", tab_id: "new-tab", workspace_id: "room" });
      expect(sent).toEqual([
        [
          "world.agent.move",
          {
            source: {
              connection_id: source.tabRef.connectionId,
              generation: 3,
              workspace_id: "room",
              tab_id: "tab",
              pane_id: "pane",
              terminal_id: "terminal",
              color_key: `${source.tabRef.connectionId}:tab`,
            },
            destination: {
              connection_id: destination.workspaceRef.connectionId,
              generation: 3,
              workspace_id: "room",
            },
          },
          180_000,
        ],
      ]);
    }
  } finally {
    bridge.call = original;
  }
});

test("busy, rolled-back and uncertain handoff results retain honest Town notices", async () => {
  const original = bridge.call;
  try {
    for (const status of ["refused", "rolled_back", "uncertain"] as const) {
      bridge.call = (async () => ({
        status,
        message: "reason",
      })) as typeof bridge.call;
      const outcome = await requestDeskMove(
        desk("core", true),
        room("tui"),
        true,
        false,
        { room: room("core", true), workspaceIds: ["room"] },
      );
      expect(outcome).toMatchObject(
        status === "refused"
          ? { status: "refused", message: "reason" }
          : {
              status: "failed",
              rolled_back: status === "rolled_back",
              message: "reason",
            },
      );
    }
  } finally {
    bridge.call = original;
  }
});

test("stale rooms/desks, shells and multi-pane desks cannot authorize a handoff", () => {
  const source = desk("core", true),
    destination = room("tui");
  expect(canMoveDeskToRoom(source, destination)).toBe(true);
  expect(canMoveDeskToRoom({ ...source, stale: true }, destination)).toBe(
    false,
  );
  expect(canMoveDeskToRoom(source, { ...destination, stale: true })).toBe(
    false,
  );
  expect(
    canMoveDeskToRoom({ ...source, observedPaneCount: 2 }, destination),
  ).toBe(false);
  expect(
    canMoveDeskToRoom(
      {
        ...source,
        paneDevices: [{ ...source.paneDevices[0]!, agentKey: undefined }],
      },
      destination,
    ),
  ).toBe(false);
});
