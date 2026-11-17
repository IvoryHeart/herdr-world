import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldObservation } from "../world/observation-v1";
import { BoardStore } from "../world/board-store";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";
import { systemClock } from "../service/ports";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
for (const mode of [
  "absent",
  "snapshot-edit",
  "native-edit",
  "cached-live",
  "retired-read",
  "unknown-read",
  "held-read",
  "beside-core",
])
  test(`snapshot GC confirms native absence and admission: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "appearance-snapshot-rpc-"));
    roots.push(root);
    const board = new BoardStore(join(root, "board.json"));
    const target = {
      connection_id: "alpha",
      kind: "pane" as const,
      native_id: "old-pane",
      witness: ["old-terminal"],
    };
    board.patch([
      { op: "appearance.set", target, fields: { avatar: "builder" } },
    ]);
    const admitted = Promise.withResolvers<void>(),
      finish = Promise.withResolvers<void>();
    const errors: unknown[] = [],
      warnings: unknown[] = [];
    const ws = {};
    const heldNative = Promise.withResolvers<{ panes: unknown[] }>(),
      reclaimed = Promise.withResolvers<void>();
    let current = true;
    const edit = () =>
      board.patch([
        {
          op: "appearance.set",
          target: {
            ...target,
            native_id: "new-pane",
            witness: ["new-terminal"],
          },
          fields: { avatar: "designer" },
        },
      ]);
    const pending = handleWorldRpc({
      id: "snapshot",
      method: "world.snapshot",
      params: {},
      req: { id: "snapshot", method: "world.snapshot" },
      ws,
      sendReply: () => true,
      sendError: (_context: string, error: unknown) => errors.push(error),
      services: {
        clock: systemClock,
        board: () => board,
        clients: new Set([ws]),
        safeSend: () => true,
        publishBoardChanged: () => {
          reclaimed.resolve();
        },
        logger: {
          warn: (_message: string, error: unknown) => warnings.push(error),
        },
        connectionManager: {
          // As the real manager: an ID it does not own (herdr-core) throws.
          readyRuntimeLease: (id: string) => {
            if (id !== "alpha") throw new Error(`unknown connection: ${id}`);
            return {
              generation: 3,
              isCurrent: () => current,
              runtime: {
                ...herdrRuntimeFixture({
                  call: async () => {
                    if (mode === "held-read") return heldNative.promise;
                    if (mode === "unknown-read") throw new Error("unavailable");
                    if (mode === "native-edit") edit();
                    if (mode === "retired-read") current = false;
                    return {
                      panes:
                        mode === "cached-live"
                          ? [{ terminal_id: "old-terminal" }]
                          : [],
                    };
                  },
                }),
              },
            };
          },
        },
        worldSnapshots: {
          observation: new WorldObservation("synthetic-service"),
          snapshot: async () => {
            admitted.resolve();
            await finish.promise;
            return {
              revision: 1,
              observed_at: 1,
              connections: [
                ...(mode === "beside-core"
                  ? [
                      {
                        connection_id: "box-core",
                        runtime: "herdr-core",
                        generation: 1,
                        snapshot_generation: 1,
                        state: "ready",
                        stale: false,
                        actionable: true,
                        snapshot: {
                          panes: [
                            {
                              pane_id: "t1",
                              terminal_id: "t1",
                              workspace_id: "hc:unplaced",
                              tab_id: "hc:unplaced:tab:main",
                              agent: "claude",
                              agent_status: "idle",
                            },
                          ],
                          tabs: [],
                          workspaces: [],
                          coverage: { panes: 1, tabs: 0, workspaces: 0 },
                          agents: [],
                        },
                      },
                    ]
                  : []),
                {
                  connection_id: "alpha",
                  generation: 3,
                  snapshot_generation: 3,
                  state: "ready",
                  stale: false,
                  actionable: true,
                  snapshot: {
                    panes: [],
                    tabs: [],
                    workspaces: [],
                    coverage: { panes: 0, tabs: 0, workspaces: 0 },
                    agents: [],
                  },
                },
              ],
            };
          },
        },
      },
    } as unknown as BridgeRpcContext);
    await admitted.promise;
    if (mode === "snapshot-edit") edit();
    finish.resolve();
    await pending;
    if (mode === "held-read") {
      expect(Object.keys(board.get().appearance ?? {})).toHaveLength(1);
      heldNative.resolve({ panes: [] });
      await reclaimed.promise;
    }
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(Object.keys(board.get().appearance ?? {})).toHaveLength(
      mode.endsWith("edit")
        ? 2
        : mode === "absent" ||
            mode === "held-read" ||
            // A core connection beside it changes nothing: alpha's absent
            // pane is still collected, and no observer fails on core's ID.
            mode === "beside-core"
          ? 0
          : 1,
    );
  });
