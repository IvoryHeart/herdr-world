import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { createMoveQueue } from "./desk-move";
import { handleBoardTownRpc } from "../rpc/board-town";
import type { ConnectionRpcContext } from "../rpc/context";
import { fakeHerdr } from "./testing/deskMoveFixture";
import { executeTownMove, type TownMoveContext } from "./town-move";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function setup(options: Parameters<typeof fakeHerdr>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), "town-move-"));
  directories.push(directory);
  const board = new BoardStore(join(directory, "board.json"));
  const herdr = fakeHerdr(options);
  const source = herdr.addTab("w1", "Source", 2);
  herdr.addTab("w1", "Keep room", 1);
  const destination = herdr.addTab("w2", "Target", 1);
  const published: number[] = [];
  const followErrors: unknown[] = [];
  let current = true;
  const context: TownMoveContext = {
    connectionId: "connection-a",
    generation: 4,
    call: herdr.call,
    isCurrent: () => current,
    queues: new Map(),
    board,
    publishBoard: (revision) => published.push(revision),
    onFollowError: (error) => followErrors.push(error),
  };
  return {
    context,
    herdr,
    board,
    source,
    destination,
    published,
    followErrors,
    retire: () => {
      current = false;
    },
  };
}

test("RPC and another adapter serialize through the same service-owned queue", async () => {
  const state = setup();
  const queue = createMoveQueue();
  state.context.queues.set(state.context.connectionId, queue);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const blocker = queue(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const calls: string[] = [];
  state.context.call = async (method, params) => {
    calls.push(method);
    return state.herdr.call(method, params);
  };
  let rpcResult: unknown;
  const rpc = handleBoardTownRpc({
    id: "move",
    method: "town.move_desk",
    params: { tab_id: state.source.tab, workspace_id: "w2" },
    route: {
      scope: "connection",
      connectionId: state.context.connectionId,
      generation: 4,
    },
    requestIsCurrent: state.context.isCurrent,
    connection: { herdr: { call: state.context.call } },
    services: {
      board: () => state.board,
      townMoveQueues: state.context.queues,
      publishBoardChanged: state.context.publishBoard,
      logger: {
        warn: (_message: string, detail: unknown) =>
          state.followErrors.push(detail),
      },
    },
    sendReply: (reply: unknown) => {
      rpcResult = reply;
      return true;
    },
    sendError: (_method: string, error: unknown) => {
      throw error;
    },
  } as unknown as ConnectionRpcContext);
  await Promise.resolve();
  expect(calls).toEqual([]);
  release.resolve();
  await blocker;
  await rpc;
  expect(rpcResult).toMatchObject({ result: { status: "moved" } });
  expect(calls).toContain("pane.move");
  expect(state.context.queues.get(state.context.connectionId)).toBe(queue);
});

test("a queued captured generation that retires never reads or moves another runtime", async () => {
  const state = setup();
  const queue = createMoveQueue();
  state.context.queues.set(state.context.connectionId, queue);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const blocker = queue(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let calls = 0;
  state.context.call = async (method, params) => {
    calls++;
    return state.herdr.call(method, params);
  };
  const move = executeTownMove(state.context, {
    kind: "desk",
    tab_id: state.source.tab,
    workspace_id: "w2",
  });
  state.retire();
  release.resolve();
  await blocker;
  expect(await move).toMatchObject({ status: "refused", reason: "stale" });
  expect(calls).toBe(0);
  expect(state.published).toEqual([]);
});

test("partial failure reconciles only observed terminal witnesses and preserves the outcome", async () => {
  const state = setup({ failAt: 2 });
  const pane = state.source.ids[0]!;
  const terminal = state.herdr.panes.get(pane)!.terminal;
  state.board.patch([
    {
      op: "string.put",
      string: {
        id: "follow",
        from: {
          anchor: {
            connection_id: state.context.connectionId,
            kind: "pane",
            native_id: pane,
            witness: [terminal],
          },
        },
        to: {
          anchor: {
            connection_id: state.context.connectionId,
            kind: "pane",
            native_id: "unobserved",
            witness: ["unobserved-terminal"],
          },
        },
      },
    },
  ]);
  const result = await executeTownMove(state.context, {
    kind: "desk",
    tab_id: state.source.tab,
    workspace_id: "w2",
  });
  expect(result).toMatchObject({ status: "failed", topology_known: true });
  const observedPane = [...state.herdr.panes].find(
    ([, candidate]) => candidate.terminal === terminal,
  )![0];
  const string = state.board.get().strings[0]!;
  expect(string.from).toMatchObject({
    anchor: { native_id: observedPane, witness: [terminal] },
  });
  expect(string.to).toMatchObject({ anchor: { native_id: "unobserved" } });
  expect(state.published).toHaveLength(1);
  expect(state.followErrors).toEqual([]);
});

test("post-move appearance and Board following finish before the next queued move", async () => {
  const state = setup();
  const following = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  state.context.call = async (method, params) => {
    if (method === "workspace.list") {
      following.resolve();
      await release.promise;
      return { workspaces: [] };
    }
    return state.herdr.call(method, params);
  };
  const first = executeTownMove(state.context, {
    kind: "desk",
    tab_id: state.source.tab,
    workspace_id: "w2",
  });
  await following.promise;
  let nextStarted = false;
  const next = state.context.queues.get(state.context.connectionId)!(
    async () => {
      nextStarted = true;
    },
  );
  try {
    await Promise.resolve();
    expect(nextStarted).toBe(false);
  } finally {
    release.resolve();
  }
  expect(await first).toMatchObject({ status: "moved" });
  await next;
  expect(nextStarted).toBe(true);
});

test("unknown partial topology is returned without retrying or guessing anchors", async () => {
  const state = setup({ failAt: 2, listFailsAfterMoves: 2 });
  const original = state.source.ids[0]!;
  const terminal = state.herdr.panes.get(original)!.terminal;
  state.board.patch([
    {
      op: "string.put",
      string: {
        id: "unknown",
        from: {
          anchor: {
            connection_id: state.context.connectionId,
            kind: "pane",
            native_id: original,
            witness: [terminal],
          },
        },
        to: {
          anchor: {
            connection_id: state.context.connectionId,
            kind: "pane",
            native_id: "other",
            witness: ["other-terminal"],
          },
        },
      },
    },
  ]);
  const result = await executeTownMove(state.context, {
    kind: "desk",
    tab_id: state.source.tab,
    workspace_id: "w2",
  });
  expect(result).toMatchObject({ status: "failed", topology_known: false });
  expect(state.herdr.moves()).toBe(2);
  expect(state.board.get().strings[0]!.from).toMatchObject({
    anchor: { native_id: original },
  });
  expect(state.published).toEqual([]);
});
