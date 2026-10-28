import { expect, test } from "bun:test";
import { handleDeskRpc } from "./desk";
import type { BridgeRpcContext } from "./context";
import { WorldDeskRegistry } from "../world/desk-state";
import { deskSessionFingerprint } from "../world/desk-observation";

const session = {
  source: "reported",
  agent: "codex",
  kind: "id",
  value: "synthetic-session",
};
const identity = {
  connection_id: "alpha",
  connection_generation: 3,
  terminal_id: "terminal-a",
  agent_session_fingerprint: deskSessionFingerprint(session),
};

function fixture() {
  const desk = new WorldDeskRegistry();
  const replies: Record<string, unknown>[] = [],
    errors: unknown[] = [],
    notifications: number[] = [];
  let current = true;
  let pane = {
    terminal_id: "terminal-a",
    agent: "codex",
    agent_session: session,
  };
  let defer: (() => Promise<void>) | undefined;
  const rpc = (method: string, params?: Record<string, unknown>) =>
    handleDeskRpc({
      id: "request",
      method,
      params,
      sendReply: (reply: Record<string, unknown>) => {
        replies.push(reply);
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        errors.push(error);
      },
      services: {
        worldDesk: desk,
        publishDeskChanged: (revision: number) => notifications.push(revision),
        connectionManager: {
          readyRuntimeLease: (id: string) =>
            id !== "alpha"
              ? null
              : {
                  generation: 3,
                  isCurrent: () => current,
                  runtime: {
                    herdr: {
                      call: async () => {
                        await defer?.();
                        return { panes: [pane] };
                      },
                    },
                  },
                },
        },
      },
    } as unknown as BridgeRpcContext);
  return {
    desk,
    replies,
    errors,
    notifications,
    rpc,
    retire: () => {
      current = false;
    },
    replace: () => {
      pane = { ...pane, agent_session: { ...session, value: "replacement" } };
    },
    defer: (callback: () => Promise<void>) => {
      defer = callback;
    },
  };
}

test("qualified mutations and Undo publish shared state only after live session admission", async () => {
  const f = fixture();
  await f.rpc("world.desk.review", {
    ...identity,
    stop_id: "turn-1",
    reviewed: true,
  });
  await f.rpc("world.desk.open", identity);
  expect(f.errors).toEqual([]);
  expect(f.desk.list().records[0]).toMatchObject({
    ...identity,
    reviewed_stop: "turn-1",
    opened_at: expect.any(Number),
  });
  expect(f.notifications).toEqual([1, 2]);
  await f.rpc("world.desk.review", {
    ...identity,
    stop_id: "turn-1",
    reviewed: false,
  });
  expect(f.desk.list().records[0]!.reviewed_stop).toBeNull();
});

test("missing owners, obsolete generations and replacement sessions cannot mutate", async () => {
  const f = fixture();
  for (const changed of [
    { connection_id: "beta" },
    { connection_generation: 2 },
    { agent_session_fingerprint: null },
  ])
    await f.rpc("world.desk.open", { ...identity, ...changed });
  f.replace();
  await f.rpc("world.desk.review", {
    ...identity,
    stop_id: "turn",
    reviewed: true,
  });
  expect(f.errors).toHaveLength(4);
  expect(f.desk.list().records).toEqual([]);
});

test("a runtime retired during admission cannot save a late mark", async () => {
  const f = fixture();
  let finish!: () => void;
  f.defer(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.rpc("world.desk.review", {
    ...identity,
    stop_id: "turn",
    reviewed: true,
  });
  f.retire();
  finish();
  await pending;
  expect(f.errors).toHaveLength(1);
  expect(f.desk.list().records).toEqual([]);
});
