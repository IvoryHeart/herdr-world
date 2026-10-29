import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../world/board-store";
import { afterHerdrClose } from "../world/board-closing";
import { handleBoardTownRpc } from "./board-town";
import type { ConnectionRpcContext } from "./context";
import { appearanceFor } from "../../../shared/appearance";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
for (const edit of [undefined, "teal", null] as const)
  test(`lost move acknowledgement keeps colour intent ${String(edit)} after native close cleanup`, async () => {
    const root = mkdtempSync(join(tmpdir(), "appearance-move-rpc-"));
    roots.push(root);
    const board = new BoardStore(join(root, "board.json"));
    const old = {
      connection_id: "alpha",
      kind: "tab" as const,
      native_id: "w1:t1",
      color_key: "alpha:w1:t1",
      witness: ["term-a"],
    };
    board.patch([
      {
        op: "appearance.set",
        target: old,
        fields: { color: "pink", status: "Continuing" },
      },
      {
        op: "appearance.set",
        target: {
          connection_id: "alpha",
          kind: "pane",
          native_id: "w1:p1",
          witness: ["term-a"],
        },
        fields: { avatar: "builder" },
      },
    ]);
    let moved = false;
    const cleaned = Promise.withResolvers<void>();
    let result: unknown;
    const errors: unknown[] = [];
    const call = async (method: string) => {
      if (method === "pane.list")
        return {
          panes: [
            {
              pane_id: moved ? "w2:p1" : "w1:p1",
              tab_id: moved ? "w2:t1" : "w1:t1",
              workspace_id: moved ? "w2" : "w1",
              terminal_id: "term-a",
            },
          ],
        };
      if (method === "tab.list")
        return {
          tabs: [
            {
              tab_id: moved ? "w2:t1" : "w1:t1",
              workspace_id: moved ? "w2" : "w1",
              label: "Analysis",
            },
          ],
        };
      if (method === "layout.export")
        return {
          layout: {
            workspace_id: "w1",
            tab_id: "w1:t1",
            root: { type: "pane", pane_id: "w1:p1" },
          },
        };
      if (method === "workspace.list")
        return { workspaces: [{ workspace_id: "w2" }] };
      if (method === "workspace.get")
        throw new Error("workspace_not_found: gone");
      if (method === "tab.get") throw new Error("tab_not_found: gone");
      if (method === "pane.move") {
        moved = true;
        afterHerdrClose(
          board,
          "alpha",
          "tab.closed",
          { data: { tab_id: "w1:t1" } },
          {
            call,
            isCurrent: () => true,
            changed: () => {
              if (!board.get().layout.colors[old.color_key]) cleaned.resolve();
            },
          },
        );
        await cleaned.promise;
        if (edit !== undefined)
          board.patch([
            { op: "appearance.set", target: old, fields: { color: edit } },
          ]);
        throw new Error("move acknowledgement lost");
      }
      throw new Error(`unexpected ${method}`);
    };
    await handleBoardTownRpc({
      id: "move",
      method: "town.move_desk",
      params: { tab_id: "w1:t1", workspace_id: "w2", allow_close_room: true },
      route: { scope: "connection", connectionId: "alpha", generation: 3 },
      requestIsCurrent: () => true,
      connection: { herdr: { call } },
      sendReply: (reply: Record<string, unknown>) => {
        result = reply.result;
        return true;
      },
      sendError: (_context: string, error: unknown) => errors.push(error),
      services: {
        board: () => board,
        publishBoardChanged: () => {},
        townMoveQueues: new Map(),
        logger: { warn: () => {} },
      },
    } as unknown as ConnectionRpcContext);
    expect(errors).toEqual([]);
    expect(result).toMatchObject({
      status: "failed",
      topology_known: true,
      topology: [{ terminal_id: "term-a", pane_id: "w2:p1", tab_id: "w2:t1" }],
    });
    if (edit === null)
      expect(board.get().layout.colors["alpha:w2:t1"]).toBeUndefined();
    else expect(board.get().layout.colors["alpha:w2:t1"]).toBe(edit ?? "pink");
    expect(
      appearanceFor(board.get().appearance, {
        ...old,
        native_id: "w2:t1",
        color_key: "alpha:w2:t1",
      })?.status,
    ).toBe("Continuing");
    expect(
      appearanceFor(board.get().appearance, {
        connection_id: "alpha",
        kind: "pane",
        native_id: "w2:p1",
        witness: ["term-a"],
      })?.avatar,
    ).toBe("builder");
  }, 10000);
