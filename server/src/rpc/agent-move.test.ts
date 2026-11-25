import { expect, test } from "bun:test";
import type { BridgeRpcContext } from "./context";
import { handleAgentMoveRpc } from "./agent-move";

/**
 * A page on a slow link lost its socket mid-move: Bun's send on the closed
 * socket returned 0 ("websocket send dropped during world.agent.move") and
 * the move's reply was gone. The move itself runs to its end; the page asks
 * again with the same move ID and learns that end, and nothing moves twice.
 */
function harness() {
  const lines: Array<[string, Record<string, unknown>]> = [];
  let started = 0;
  const logger = {
    child: () => logger,
    info: (message: string, fields: Record<string, unknown> = {}) =>
      void lines.push([message, fields]),
    warn: (message: string, fields: Record<string, unknown> = {}) =>
      void lines.push([message, fields]),
  };
  const services = {
    logger,
    connectionProfiles: {
      profilesById: () => {
        started += 1;
        return new Map();
      },
    },
    // No runtime answers, so the move ends at once: "A runtime reconnected".
    connectionManager: { has: () => false },
    board: () => null,
    publishBoardChanged() {},
    publishWorldInvalidation() {},
  };
  const send = async (params: Record<string, unknown>, open = true) => {
    const replies: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    await handleAgentMoveRpc({
      id: "r1",
      method: "world.agent.move",
      params,
      // A closed socket drops the send (Bun returns 0).
      sendReply: (message: Record<string, unknown>) => {
        if (open) replies.push(message);
        return open;
      },
      sendError: (_context: string, error: unknown) =>
        void errors.push(String(error)),
      services,
    } as unknown as BridgeRpcContext);
    return { reply: replies[0]?.result, error: errors[0] };
  };
  return { lines, send, started: () => started };
}

const address = {
  connection_id: "tui-a",
  generation: 1,
  workspace_id: "w1",
  tab_id: "t1",
  pane_id: "p1",
  terminal_id: "term-1",
  color_key: "tui-a:w1:t1",
};
const move = {
  source: address,
  destination: { connection_id: "core-a", generation: 1, workspace_id: "w2" },
};

test("a page that lost the reply learns how its move ended, and it moves once", async () => {
  const { lines, send, started } = harness();
  const lost = await send({ ...move, move_id: "move-lost-1" }, false);
  expect(lost.reply).toBeUndefined();
  expect(lines.map(([message]) => message)).toContain("move reply lost");

  const followed = await send({
    ...move,
    move_id: "move-lost-1",
    follow: true,
  });
  expect(followed.reply).toMatchObject({
    status: "refused",
    reason: "reconnected",
  });
  expect(started()).toBe(1);
});

test("the same move ID sent twice at once joins the running move", async () => {
  const { send, started } = harness();
  const [a, b] = await Promise.all([
    send({ ...move, move_id: "move-twice-1" }),
    send({ ...move, move_id: "move-twice-1" }),
  ]);
  expect(a.reply).toEqual(b.reply);
  expect(started()).toBe(1);
});

test("following a move World has no record of starts nothing", async () => {
  const { send, started } = harness();
  expect(
    (await send({ ...move, move_id: "move-unknown", follow: true })).reply,
  ).toMatchObject({ status: "refused", reason: "untracked" });
  expect(started()).toBe(0);
  expect((await send({ ...move, move_id: "bad id!" })).error).toContain(
    "Invalid move ID.",
  );
});
