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
import {
  appearanceFor,
  type AppearanceFields,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import { handleAppearanceRpc } from "../rpc/appearance";
import type { BridgeRpcContext } from "../rpc/context";

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

const destinationEdits: {
  name: string;
  kind: "tab" | "pane";
  fields: AppearanceFields;
  status?: string;
  color?: string;
  avatar?: string;
  seed?: boolean;
  move?: "pane";
}[] = [
  {
    name: "status and colour",
    kind: "tab",
    fields: { status: "Edited at destination", color: "teal" },
    status: "Edited at destination",
    color: "teal",
  },
  {
    name: "status reset",
    kind: "tab",
    fields: { status: null },
    color: "pink",
  },
  {
    name: "colour reset",
    kind: "tab",
    fields: { color: null },
    status: "Before move",
  },
  { name: "both resets", kind: "tab", fields: { color: null, status: null } },
  {
    name: "status preserves unedited source colour",
    kind: "tab",
    fields: { status: "Edited at destination" },
    status: "Edited at destination",
    color: "pink",
  },
  {
    name: "colour preserves unedited source status",
    kind: "tab",
    fields: { color: "teal" },
    status: "Before move",
    color: "teal",
  },
  {
    name: "first destination choice without source appearance",
    kind: "tab",
    seed: false,
    fields: { color: "red", status: "New choice" },
    color: "red",
    status: "New choice",
  },
  {
    name: "pane avatar",
    kind: "pane",
    fields: { avatar: "designer" },
    avatar: "designer",
  },
  { name: "pane avatar reset", kind: "pane", fields: { avatar: null } },
  {
    name: "pane avatar during a pane move",
    move: "pane",
    kind: "pane",
    fields: { avatar: "designer" },
    avatar: "designer",
  },
  {
    name: "pane avatar reset during a pane move",
    move: "pane",
    kind: "pane",
    fields: { avatar: null },
  },
];
test.each(destinationEdits)(
  "move reconciliation preserves a qualified destination $name edit",
  async (entry) => {
    const state = setup();
    const connection_id = state.context.connectionId;
    const terminals = state.source.ids.map(
      (id) => state.herdr.panes.get(id)!.terminal,
    );
    const workspaces = new Set(["w1", "w2"]);
    if (entry.seed !== false)
      state.board.patch([
        {
          op: "appearance.set",
          target: {
            connection_id,
            kind: "tab",
            native_id: state.source.tab,
            witness: terminals,
            color_key: tabCardKey(connection_id, state.source.tab, workspaces),
          },
          fields: { status: "Before move", color: "pink" },
        },
        {
          op: "appearance.set",
          target: {
            connection_id,
            kind: "pane",
            native_id: state.source.ids[0]!,
            witness: [terminals[0]!],
          },
          fields: { avatar: "builder" },
        },
      ]);
    const runtimeCall = async (
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method === "workspace.list")
        return {
          workspaces: [...workspaces].map((workspace_id) => ({ workspace_id })),
        };
      if (method === "tab.list" && params.workspace_id === undefined)
        return {
          tabs: [...state.herdr.tabs].map(([tab_id, tab]) => ({
            tab_id,
            workspace_id: tab.workspace,
            label: tab.label,
          })),
        };
      return state.herdr.call(method, params);
    };
    const probing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let held = false;
    state.context.call = async (method, params) => {
      if (
        method === (entry.move === "pane" ? "pane.list" : "workspace.list") &&
        state.herdr.moves() > 0 &&
        !held
      ) {
        held = true;
        probing.resolve();
        await release.promise;
      }
      return runtimeCall(method, params);
    };
    const pending = executeTownMove(
      state.context,
      entry.move === "pane"
        ? {
            kind: "pane",
            pane_id: state.source.ids[0]!,
            tab_id: state.destination.tab,
          }
        : { kind: "desk", tab_id: state.source.tab, workspace_id: "w2" },
    );
    await probing.promise;
    const [pane_id, pane] = [...state.herdr.panes].find(
      ([, pane]) => pane.terminal === terminals[0],
    )!;
    const target =
      entry.kind === "tab"
        ? {
            connection_id,
            kind: "tab" as const,
            native_id: pane.tab,
            witness: terminals,
            color_key: tabCardKey(connection_id, pane.tab, workspaces),
          }
        : {
            connection_id,
            kind: "pane" as const,
            native_id: pane_id,
            witness: [terminals[0]!],
          };
    let accepted = false;
    let error: unknown;
    try {
      await handleAppearanceRpc({
        method: "world.appearance.patch",
        id: "destination-edit",
        requestIsCurrent: state.context.isCurrent,
        params: {
          ...target,
          connection_generation: state.context.generation,
          fields: entry.fields,
        },
        services: {
          board: () => state.board,
          publishBoardChanged: () => {},
          publishWorldInvalidation: () => {},
          connectionManager: {
            readyRuntimeLease: () => ({
              connectionId: connection_id,
              generation: state.context.generation,
              isCurrent: state.context.isCurrent,
              runtime: { herdr: { call: runtimeCall } },
            }),
          },
        },
        sendReply: () => {
          accepted = true;
          return true;
        },
        sendError: (_method: string, value: unknown) => {
          error = value;
        },
      } as unknown as BridgeRpcContext);
      expect(error).toBeUndefined();
      expect(accepted).toBe(true);
    } finally {
      release.resolve();
    }
    expect(await pending).toMatchObject({ status: "moved" });
    const document = state.board.get();
    const saved = appearanceFor(document.appearance, target);
    expect(saved).toBeDefined();
    if (entry.kind === "tab") {
      expect(saved?.status).toBe(entry.status);
      expect(
        document.layout.colors[target.color_key!] as string | undefined,
      ).toBe(entry.color);
    } else expect(saved?.avatar).toBe(entry.avatar);
  },
);

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
