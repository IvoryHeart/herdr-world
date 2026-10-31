import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../world/board-store";
import { handleAppearanceRpc } from "./appearance";
import type { BridgeRpcContext } from "./context";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const identity = {
  connection_id: "alpha",
  connection_generation: 3,
  kind: "tab",
  native_id: "tab-1",
  color_key: "alpha:tab-1",
  witness: ["terminal-1"],
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-appearance-rpc-"));
  roots.push(root);
  const board = new BoardStore(join(root, "board.json"));
  const errors: unknown[] = [],
    replies: unknown[] = [],
    notifications: number[] = [],
    calls: string[] = [];
  let current = true,
    terminal = "terminal-1",
    fail = false;
  let defer: ((method: string) => void) | undefined;
  const rpc = (
    method = "world.appearance.patch",
    params: Record<string, unknown> = {
      ...identity,
      fields: { status: "Reviewing" },
    },
  ) =>
    handleAppearanceRpc({
      id: "test",
      method,
      params,
      requestIsCurrent: () => current,
      sendError: (_context: string, error: unknown) => errors.push(error),
      sendReply: (reply: unknown) => {
        replies.push(reply);
        return true;
      },
      services: {
        board: () => board,
        publishBoardChanged: (rev: number) => notifications.push(rev),
        publishWorldInvalidation: () => {},
        connectionManager: {
          readyRuntimeLease: (id: string) =>
            id !== "alpha"
              ? null
              : {
                  generation: 3,
                  isCurrent: () => current,
                  runtime: {
                    herdr: {
                      call: async (method: string) => {
                        calls.push(method);
                        const result =
                          method === "pane.list"
                            ? {
                                panes: [
                                  {
                                    pane_id: "pane-1",
                                    tab_id: "tab-1",
                                    terminal_id: terminal,
                                  },
                                ],
                              }
                            : method === "tab.list"
                              ? { tabs: [{ tab_id: "tab-1" }] }
                              : method === "workspace.list"
                                ? { workspaces: [{ workspace_id: "space-1" }] }
                                : {};
                        defer?.(method);
                        if (fail) throw new Error("synthetic native failure");
                        return result;
                      },
                    },
                  },
                },
        },
      },
    } as unknown as BridgeRpcContext);
  return {
    board,
    errors,
    replies,
    notifications,
    calls,
    rpc,
    retire: () => {
      current = false;
    },
    replace: () => {
      terminal = "replacement";
    },
    defer: (fn: (method: string) => void) => {
      defer = fn;
    },
    fail: () => {
      fail = true;
    },
  };
}

test("admitted field patches publish the shared revision and native rename is separate", async () => {
  const f = fixture();
  await f.rpc();
  await f.rpc("world.appearance.rename", {
    ...identity,
    label: "Native tab name",
  });
  expect(f.errors).toEqual([]);
  expect(f.notifications).toEqual([1]);
  expect(f.calls).toContain("tab.rename");
  expect(f.board.get().appearance).toBeDefined();
  expect(JSON.stringify(f.board.get())).not.toContain("Native tab name");
});
test("wrong connection, generation, witness and colour alias cannot mutate", async () => {
  for (const patch of [
    { connection_id: "beta" },
    { connection_generation: 2 },
    { witness: ["other-terminal"] },
    { color_key: "beta:tab-1" },
  ]) {
    const f = fixture();
    await f.rpc("world.appearance.patch", {
      ...identity,
      ...patch,
      fields: { color: "pink" },
    });
    expect(f.errors).toHaveLength(1);
    expect(f.board.get().revision).toBe(0);
    expect(f.notifications).toEqual([]);
  }
});
test("runtime retirement during a read cannot authorize metadata or a rename", async () => {
  for (const method of ["world.appearance.patch", "world.appearance.rename"]) {
    const f = fixture();
    f.defer(f.retire);
    await f.rpc(method, {
      ...identity,
      fields: { status: "Old runtime" },
      label: "Old name",
    });
    expect(f.errors).toHaveLength(1);
    expect(f.board.get().revision).toBe(0);
    expect(f.calls).not.toContain("tab.rename");
  }
});
test("replacement and native failure leave metadata unchanged", async () => {
  const f = fixture();
  f.replace();
  await f.rpc();
  expect(f.errors).toHaveLength(1);
  expect(f.board.get().revision).toBe(0);
  const failed = fixture();
  failed.fail();
  await failed.rpc();
  expect(failed.errors).toHaveLength(1);
  expect(failed.replies).toHaveLength(0);
  expect(failed.board.get().revision).toBe(0);
});

test("finite admission matrix checks both operations across connection, generation, witness and read retirement", async () => {
  for (const method of ["world.appearance.patch", "world.appearance.rename"])
    for (const connection_id of ["alpha", "beta"])
      for (const connection_generation of [2, 3])
        for (const witness of [["terminal-1"], ["replacement"]])
          for (const retireAt of [
            null,
            "pane.list",
            "tab.list",
            "workspace.list",
          ]) {
            const f = fixture();
            f.defer((reading) => {
              if (reading === retireAt) f.retire();
            });
            await f.rpc(method, {
              ...identity,
              connection_id,
              connection_generation,
              witness,
              fields: { status: "Matrix" },
              label: "Matrix name",
            });
            const admitted =
              connection_id === "alpha" &&
              connection_generation === 3 &&
              witness[0] === "terminal-1" &&
              retireAt === null;
            expect(f.errors.length === 0).toBe(admitted);
            expect(f.board.get().revision).toBe(
              admitted && method === "world.appearance.patch" ? 1 : 0,
            );
            expect(f.calls.includes("tab.rename")).toBe(
              admitted && method === "world.appearance.rename",
            );
          }
});
