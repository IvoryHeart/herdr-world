import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { createMoveQueue, type HerdrCall } from "./desk-move";
import { runGroupMove } from "./group-move";
import type { GroupMoveRequest } from "./world-cli-groups";
import type { TownMoveContext } from "./town-move";
import { fakeHerdr } from "./testing/deskMoveFixture";
import { CliError } from "./world-cli-errors";
import { createWorldCliService } from "./world-cli-service";
import type { WorldSnapshotResult } from "./snapshot";
import { appearanceFor } from "../../../shared/appearance";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function setup(options: Parameters<typeof fakeHerdr>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), "group-move-"));
  directories.push(directory);
  const board = new BoardStore(join(directory, "board.json"));
  const herdr = fakeHerdr(options);
  const source = herdr.addTab("w1", "Shared", 3);
  herdr.addTab("w1", "Keep room", 1);
  const destination = herdr.addTab("w2", "Target", 1);
  const names = new Map(
    source.ids.map((id, index) => [id, ["a", "b", "c"][index]!]),
  );
  let current = true;
  const call: HerdrCall = async (method, params) => {
    if (method === "workspace.list")
      return {
        workspaces: [
          { workspace_id: "w1", label: "Origin" },
          { workspace_id: "w2", label: "Workshop" },
        ],
      };
    if (method === "agent.list")
      return {
        agents: [...herdr.panes].map(([pane_id, pane]) => ({
          pane_id,
          terminal_id: pane.terminal,
          agent: "codex",
          name: names.get(pane_id),
        })),
      };
    const result = await herdr.call(method, params);
    if (method !== "pane.list") return result;
    return {
      panes: (result as { panes: object[] }).panes.map((pane) => ({
        ...pane,
        agent: "codex",
      })),
    };
  };
  const published: number[] = [];
  const context: TownMoveContext = {
    connectionId: "connection-a",
    generation: 4,
    call,
    isCurrent: () => current,
    queues: new Map(),
    board,
    publishBoard: (revision) => published.push(revision),
    onFollowError: (error) => {
      throw error;
    },
  };
  const request: GroupMoveRequest = {
    connection_id: context.connectionId,
    generation: 4,
    kind: "room",
    destination_id: "w2",
    destination_workspace_id: "w2",
    pane_id: source.ids[0]!,
    terminal_id: herdr.panes.get(source.ids[0]!)!.terminal,
    tab_id: source.tab,
    allow_close_room: false,
    preview: true,
  };
  return {
    context,
    request,
    herdr,
    source,
    destination,
    board,
    names,
    published,
    retire: () => {
      current = false;
    },
  };
}
async function plan(state: ReturnType<typeof setup>) {
  const result = await runGroupMove(state.context, state.request);
  expect(result.status).toBe("preview");
  return (result as { plan: string }).plan;
}

test("CLI movement carries the latest appearance fields through post-move probes", async () => {
  const state = setup();
  const terminal = state.request.terminal_id;
  const target = {
    connection_id: state.context.connectionId,
    kind: "tab" as const,
    native_id: state.source.tab,
    color_key: `${state.context.connectionId}:${state.source.tab}`,
    witness: state.source.ids.map((id) => state.herdr.panes.get(id)!.terminal),
  };
  state.board.patch([
    {
      op: "appearance.set",
      target,
      fields: { status: "Before move", color: "pink" },
    },
  ]);
  const expected_plan = await plan(state);
  const call = state.context.call;
  let updated = false;
  state.context.call = async (method, params) => {
    if (method === "workspace.list" && state.herdr.moves() > 0 && !updated) {
      updated = true;
      state.board.patch([
        {
          op: "appearance.set",
          target,
          fields: { status: "Edited during move", color: "teal" },
        },
      ]);
    }
    return call(method, params);
  };
  const result = await runGroupMove(state.context, {
    ...state.request,
    preview: false,
    expected_plan,
  });
  expect(result).toMatchObject({ status: "moved" });
  if (result.status !== "moved") throw new Error("Expected the move to finish");
  expect(updated).toBe(true);
  const document = state.board.get();
  const saved = appearanceFor(document.appearance, {
    ...target,
    native_id: result.tab_id,
    witness: [terminal],
  });
  expect(saved?.status).toBe("Edited during move");
  expect(document.layout.colors[saved!.color_key!]).toBe("teal");
});

test("room preview names the entire desk, then delegates the real move", async () => {
  const state = setup();
  const preview = await runGroupMove(state.context, state.request);
  expect(preview).toMatchObject({
    summary: "Moves desk Shared (3 agents: a, b, c) to room Workshop",
  });
  expect(state.herdr.moves()).toBe(0);
  const result = await runGroupMove(state.context, {
    ...state.request,
    preview: false,
    expected_plan: (preview as { plan: string }).plan,
  });
  expect(result).toMatchObject({
    status: "moved",
    workspace_id: "w2",
    summary: expect.stringContaining("Done ·"),
  });
  expect(state.herdr.moves()).toBe(3);
  expect(
    [...state.herdr.panes.values()].filter((pane) => pane.workspace === "w2"),
  ).toHaveLength(4);
});

test("queued CLI preview revalidation shares the queue and refuses changed occupants", async () => {
  const state = setup();
  const expected_plan = await plan(state);
  const queue = createMoveQueue();
  state.context.queues.set(state.context.connectionId, queue);
  const release = Promise.withResolvers<void>();
  const blocker = queue(() => release.promise);
  const move = runGroupMove(state.context, {
    ...state.request,
    preview: false,
    expected_plan,
  });
  state.names.set(state.source.ids[1]!, "replacement");
  expect(state.herdr.moves()).toBe(0);
  release.resolve();
  await blocker;
  await expect(move).rejects.toMatchObject({
    code: "refused",
    result: { status: "refused", reason: "desk_changed" },
  });
  expect(state.herdr.moves()).toBe(0);
  expect(state.context.queues.get(state.context.connectionId)).toBe(queue);
});

test.each(["room", "desk"] as const)(
  "%s preview ignores incidental runtime activity",
  async (kind) => {
    const state = setup();
    if (kind === "desk")
      state.request = {
        ...state.request,
        kind,
        destination_id: state.destination.tab,
      };
    const call = state.context.call;
    let activity = 1;
    state.context.call = async (method, params) => {
      const response = await call(method, params);
      if (method !== "pane.list") return response;
      return {
        panes: (response as { panes: object[] }).panes.map((pane) => ({
          ...pane,
          revision: activity,
          focused: activity === 1,
          agent_status: activity === 1 ? "working" : "idle",
        })),
      };
    };
    const expected_plan = await plan(state);
    activity++;
    expect(
      await runGroupMove(state.context, {
        ...state.request,
        preview: false,
        expected_plan,
      }),
    ).toMatchObject({ status: "moved" });
  },
);

test("a changed destination refuses a previously reviewed move", async () => {
  const state = setup();
  const expected_plan = await plan(state);
  const call = state.context.call;
  state.context.call = async (method, params) =>
    method === "workspace.list"
      ? { workspaces: [{ workspace_id: "w1", label: "Origin" }] }
      : call(method, params);
  await expect(
    runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    }),
  ).rejects.toMatchObject({ code: "refused" });
  expect(state.herdr.moves()).toBe(0);
});

test("a queued retired lease makes no reads or moves after admission", async () => {
  const state = setup();
  const expected_plan = await plan(state);
  const queue = createMoveQueue();
  state.context.queues.set(state.context.connectionId, queue);
  const release = Promise.withResolvers<void>();
  const blocker = queue(() => release.promise);
  let calls = 0;
  const original = state.context.call;
  state.context.call = (method, params) => {
    calls++;
    return original(method, params);
  };
  const move = runGroupMove(state.context, {
    ...state.request,
    preview: false,
    expected_plan,
  });
  state.retire();
  release.resolve();
  await blocker;
  await expect(move).rejects.toMatchObject({
    code: "refused",
    result: { reason: "stale" },
  });
  expect(calls).toBe(0);
});

test("a desk change between preflight and native read refuses the whole move", async () => {
  const state = setup();
  const expected_plan = await plan(state);
  const original = state.context.call;
  state.context.call = async (method, params) => {
    if (method === "layout.export")
      state.herdr.panes.set("new-pane", {
        terminal: "new-terminal",
        tab: state.source.tab,
        workspace: "w1",
      });
    return original(method, params);
  };
  await expect(
    runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    }),
  ).rejects.toMatchObject({
    code: "refused",
    result: { reason: "desk_changed" },
  });
  expect(state.herdr.moves()).toBe(0);
});

test("partial moves retain actual outcome and reconcile observed Board anchors", async () => {
  const state = setup({ failAt: 2 });
  const original = state.context.call;
  state.context.call = async (method, params) => {
    if (method === "pane.move" && state.herdr.moves() >= 2)
      throw new Error("rollback refused");
    return original(method, params);
  };
  state.board.patch([
    {
      op: "string.put",
      string: {
        id: "follow",
        from: {
          anchor: {
            connection_id: "connection-a",
            kind: "pane",
            native_id: state.request.pane_id,
            witness: [state.request.terminal_id],
          },
        },
        to: {
          anchor: {
            connection_id: "connection-a",
            kind: "pane",
            native_id: "other",
            witness: ["other-terminal"],
          },
        },
      },
    },
  ]);
  const expected_plan = await plan(state);
  let failure: CliError | undefined;
  try {
    await runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    });
  } catch (error) {
    failure = error as CliError;
  }
  expect(failure?.result).toMatchObject({
    status: "failed",
    topology_known: true,
    rolled_back: false,
    summary: expect.stringContaining("Partly done"),
  });
  const observed = [...state.herdr.panes].find(
    ([, pane]) => pane.terminal === state.request.terminal_id,
  )!;
  expect(state.board.get().strings[0]!.from).toMatchObject({
    anchor: { native_id: observed[0] },
  });
  expect(state.published).toHaveLength(1);
});

test("Unknown preserves native failure without retrying an uncertain pane move", async () => {
  const state = setup({ uncertainAt: 1, listFailsAfterMoves: 1 });
  const expected_plan = await plan(state);
  await expect(
    runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    }),
  ).rejects.toMatchObject({
    code: "unavailable",
    result: {
      status: "failed",
      topology_known: false,
      summary: expect.stringContaining("Unknown"),
    },
  });
  expect(state.herdr.moves()).toBe(1);
});

test("Desk membership uses one compatible pane and requires a fresh preview", async () => {
  const state = setup();
  state.request.kind = "desk";
  state.request.destination_id = state.destination.tab;
  const expected_plan = await plan(state);
  expect(
    await runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    }),
  ).toMatchObject({ status: "moved", tab_id: state.destination.tab });
  expect(state.herdr.moves()).toBe(1);
  await expect(
    runGroupMove(state.context, { ...state.request, preview: false }),
  ).rejects.toMatchObject({ code: "refused" });
  await expect(
    runGroupMove(state.context, { ...state.request, generation: 5 }),
  ).rejects.toMatchObject({ code: "refused" });
});

test("a reused pane ID after a Desk preview never moves the replacement terminal", async () => {
  const state = setup();
  state.request.kind = "desk";
  state.request.destination_id = state.destination.tab;
  const expected_plan = await plan(state);
  const original = state.context.call;
  state.context.call = async (method, params) => {
    if (method === "layout.export")
      state.herdr.panes.get(state.request.pane_id)!.terminal =
        "replacement-terminal";
    return original(method, params);
  };
  await expect(
    runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    }),
  ).rejects.toMatchObject({
    code: "refused",
    result: { reason: "desk_changed" },
  });
  expect(state.herdr.moves()).toBe(0);
});

test("the actual CLI service injects the RPC-owned queue and exact lease", async () => {
  const state = setup();
  const queue = createMoveQueue();
  const release = Promise.withResolvers<void>();
  const admitted = Promise.withResolvers<void>();
  const blocker = queue(() => release.promise);
  state.context.queues.set(state.context.connectionId, (work) => {
    admitted.resolve();
    return queue(work);
  });
  const snapshot = {
    connections: [
      {
        connection_id: "connection-a",
        generation: 4,
        snapshot_generation: 4,
        state: "ready",
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: [{ workspace_id: "w2", label: "Workshop" }],
          tabs: [...state.herdr.tabs].map(([tab_id, tab]) => ({
            tab_id,
            workspace_id: tab.workspace,
            label: tab.label,
          })),
          ...((await state.context.call("pane.list", {})) as object),
          ...((await state.context.call("agent.list", {})) as object),
        },
      },
    ],
  } as unknown as WorldSnapshotResult;
  const selected: string[] = [];
  let boardReads = 0;
  const service = createWorldCliService({
    board: () => {
      boardReads++;
      return state.board;
    },
    townMoveQueues: state.context.queues,
    publishBoard: state.context.publishBoard,
    broadcast: () => {},
    snapshots: () => ({ snapshot: async () => snapshot }),
    connections: () => ({
      list: () => [],
      defaultId: () => {
        throw new Error("must not choose a default host");
      },
      readyRuntimeLease: (id) => {
        selected.push(id);
        return {
          connectionId: "connection-a",
          generation: 4,
          isCurrent: state.context.isCurrent,
          runtime: { sshHost: () => null, herdr: { call: state.context.call } },
        };
      },
    }),
  });
  expect(boardReads).toBe(0);
  const send = async (params: object) =>
    (
      await service.http(
        new Request("http://localhost/api/world/cli", {
          method: "POST",
          body: JSON.stringify({
            command: "group add",
            params: {
              group: "room:connection-a/w2",
              agent: `terminal:${state.request.terminal_id}`,
              connection: "connection-a",
              herdr: true,
              ...params,
            },
          }),
        }),
        { address: "127.0.0.1", port: 12345 },
        8788,
        () => true,
      )
    ).json();
  const preview = (await send({ preview: true })) as {
    ok: boolean;
    result: { plan: string };
  };
  expect(preview.ok).toBe(true);
  const move = send({ expected_plan: preview.result.plan });
  await admitted.promise;
  expect(state.herdr.moves()).toBe(0);
  release.resolve();
  await blocker;
  expect(await move).toMatchObject({
    ok: true,
    result: { status: "moved", workspace_id: "w2" },
  });
  expect(selected).toEqual(["connection-a", "connection-a"]);
});

test.each([
  ["inherited", false],
  ["explicit", true],
] as const)(
  "Room move preserves %s desk colour after preview",
  async (_kind, own) => {
    const state = setup();
    const child = state.request.terminal_id;
    const parent = state.herdr.panes.get(state.destination.ids[0]!)!.terminal;
    const expected_plan = await plan(state);
    state.board.patch([
      {
        op: "spawn.record",
        claims: [
          {
            child: { connection_id: "connection-a", terminal_id: child },
            parent: { connection_id: "connection-a", terminal_id: parent },
            source: "herdr:spawned_by",
            generation: 4,
            observed_at: 1,
          },
        ],
      },
      {
        op: "card.color",
        key: `connection-a:${state.destination.tab}`,
        color: "pink",
      },
      ...(own
        ? [
            {
              op: "card.color" as const,
              key: `connection-a:${state.source.tab}`,
              color: "blue" as const,
            },
          ]
        : []),
    ]);
    const result = await runGroupMove(state.context, {
      ...state.request,
      preview: false,
      expected_plan,
    });
    expect(result.status).toBe("moved");
    const colors = state.board.get().layout.colors;
    const movedKey = `connection-a:${(result as { tab_id: string }).tab_id}`;
    if (own) expect(colors[movedKey]).toBe("blue");
    else expect(Object.hasOwn(colors, movedKey)).toBe(false);
  },
);
