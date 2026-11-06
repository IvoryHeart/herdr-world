import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";
import { moveBoardPane, type BoardPaneMoveRequest } from "./boardPaneMove";

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
