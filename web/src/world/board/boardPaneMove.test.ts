import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";
import { moveBoardPane, type BoardPaneMoveRequest } from "./boardPaneMove";
import {
  cardAgentAddress,
  otherRuntimeRooms,
  requestAgentHandoff,
  workspaceRoom,
} from "../town/townRuntimeMove";

function fixture() {
  const spaces = [
    {
      label: "Synthetic room",
      tabs: [
        {
          label: "Source",
          panes: [["working"], ["idle"]] as ["working" | "idle"][],
        },
        { label: "Destination", panes: [["idle"]] as ["idle"][] },
      ],
    },
  ];
  const model = projectBoard(
    fixtureWorld([fixtureHost("alpha", spaces), fixtureHost("beta", spaces)]),
  );
  const [source, target] = model.tabs;
  const request: BoardPaneMoveRequest = {
    source: source!,
    target: target!,
    pane: source!.panes[1]!,
    sourceWorkspace: model.workspaceByKey.get(source!.workspaceKey)!,
    targetWorkspace: model.workspaceByKey.get(target!.workspaceKey)!,
  };
  return { model, request };
}

test("a single-pane move calls the shared service on its captured host and runtime", async () => {
  const { request } = fixture();
  const calls: unknown[] = [];
  const outcome = await moveBoardPane(
    request,
    false,
    (connectionId, generation) => ({
      async call(method, params, timeout) {
        calls.push({ connectionId, generation, method, params, timeout });
        return {
          status: "moved",
          tab_id: request.target.nativeId,
          workspace_id: request.targetWorkspace.nativeId,
        };
      },
    }),
  );
  expect(outcome.status).toBe("moved");
  expect(calls).toEqual([
    {
      connectionId: "alpha",
      generation: 1,
      method: "town.move_pane",
      params: {
        pane_id: request.pane.leaf.pane.pane_id,
        tab_id: request.target.nativeId,
        allow_close_room: false,
      },
      timeout: 90_000,
    },
  ]);
});

test("foreign, stale and replaced runtime targets cannot receive a pane move", async () => {
  const { model, request } = fixture();
  const foreign = model.tabs.find(
    (tab) => tab.hostKey !== request.source.hostKey,
  )!;
  const attempts = [
    {
      ...request,
      target: foreign,
      targetWorkspace: model.workspaceByKey.get(foreign.workspaceKey)!,
    },
    { ...request, target: { ...request.target, actionable: false } },
    {
      ...request,
      targetWorkspace: { ...request.targetWorkspace, generation: 2 },
    },
  ];
  let connections = 0;
  for (const attempt of attempts) {
    const outcome = await moveBoardPane(attempt, true, () => {
      connections++;
      throw new Error("must not connect");
    });
    expect(outcome.status).toBe("refused");
  }
  expect(connections).toBe(0);
});

test("a missing move outcome stays uncertain instead of claiming rollback", async () => {
  const { request } = fixture();
  expect(
    await moveBoardPane(request, true, () => ({
      async call() {
        return undefined;
      },
    })),
  ).toMatchObject({
    status: "failed",
    rolled_back: false,
    topology_known: false,
  });
});

test("a one-agent card dropped on another runtime's tab resumes there", async () => {
  const { model, request } = fixture();
  const source = request.target;
  const sourceWorkspace = request.targetWorkspace;
  const target = model.tabs.find((tab) => tab.hostKey !== source.hostKey)!;
  const targetWorkspace = model.workspaceByKey.get(target.workspaceKey)!;
  const calls: unknown[] = [];
  const outcome = await moveBoardPane(
    {
      source,
      target,
      pane: source.panes[0]!,
      sourceWorkspace,
      targetWorkspace,
    },
    false,
    () => {
      throw new Error("must not move a pane");
    },
    async (method, params) => {
      calls.push({ method, params });
      return { status: "moved", target: { tab_id: "t9", workspace_id: "w9" } };
    },
  );
  expect(outcome).toEqual({
    status: "moved",
    tab_id: "t9",
    workspace_id: "w9",
  });
  expect(calls).toEqual([
    {
      method: "world.agent.move",
      params: {
        source: {
          connection_id: "alpha",
          generation: 1,
          workspace_id: sourceWorkspace.nativeId,
          tab_id: source.nativeId,
          pane_id: source.panes[0]!.leaf.pane.pane_id,
          terminal_id: source.panes[0]!.leaf.terminalId,
          color_key: source.key,
        },
        destination: {
          connection_id: "beta",
          generation: 1,
          workspace_id: targetWorkspace.nativeId,
        },
      },
    },
  ]);
});

test("with nothing to resume the move asks, and goes fresh only once confirmed", async () => {
  const { model, request } = fixture();
  const target = model.tabs.find(
    (tab) => tab.hostKey !== request.target.hostKey,
  )!;
  const room = workspaceRoom(model.workspaceByKey.get(target.workspaceKey)!);
  const source = cardAgentAddress(request.target, request.targetWorkspace);
  const sent: unknown[] = [];
  const call = (async (_method: string, params: { fresh?: boolean }) => {
    sent.push(params.fresh ?? false);
    return params.fresh
      ? { status: "moved", target: { tab_id: "t9", workspace_id: "w9" } }
      : {
          status: "confirm",
          message: "It starts fresh there. Move it anyway?",
        };
  }) as never;
  const asked: string[] = [];
  expect(
    await requestAgentHandoff(source, room, call, (message) => {
      asked.push(message);
      return false;
    }),
  ).toEqual({ status: "refused", reason: "cancelled", message: "Not moved." });
  expect(sent).toEqual([false]);
  expect(
    await requestAgentHandoff(source, room, call, () => true),
  ).toMatchObject({ status: "moved", tab_id: "t9" });
  expect(sent).toEqual([false, false, true]);
  expect(asked).toEqual(["It starts fresh there. Move it anyway?"]);
});

test("a refused move shows the service's own reason and words, not a blanket busy", async () => {
  const { model, request } = fixture();
  const target = model.tabs.find(
    (tab) => tab.hostKey !== request.target.hostKey,
  )!;
  const room = workspaceRoom(model.workspaceByKey.get(target.workspaceKey)!);
  const source = cardAgentAddress(request.target, request.targetWorkspace);
  const message =
    "Ada didn't start there: No harness. It resumed where it was.";
  const call = (async () => ({
    status: "refused",
    reason: "start_failed",
    message,
  })) as never;
  expect(await requestAgentHandoff(source, room, call)).toEqual({
    status: "refused",
    reason: "start_failed",
    message,
  });
});

test("Move to… offers only rooms of another runtime: a second view of the same Herdr is not one", () => {
  const rooms = [
    { key: "a", connectionId: "tui", stale: false },
    { key: "b", connectionId: "tui-saved", stale: false },
    { key: "c", connectionId: "core", stale: false },
    { key: "d", connectionId: "core-old", stale: true },
  ];
  const endpoint = new Map([
    ["tui", "herdr:local:/synthetic/herdr.sock"],
    ["tui-saved", "herdr:local:/synthetic/herdr.sock"],
    ["core", "core:local:/synthetic/core.sock"],
    ["core-old", "core:local:/synthetic/old.sock"],
  ]);
  const keys = (from: string) =>
    otherRuntimeRooms(rooms, { connection_id: from }, (id) =>
      endpoint.get(id),
    ).map((room) => room.key);
  expect(keys("tui")).toEqual(["c"]);
  expect(keys("tui-saved")).toEqual(["c"]);
  expect(keys("core")).toEqual(["a", "b"]);
});
