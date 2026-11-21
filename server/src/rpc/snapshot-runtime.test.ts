import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore, emptyBoardDocument } from "../world/board-store";
import { WorldObservation } from "../world/observation-v1";
import { systemClock } from "../service/ports";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";

for (const runtime of ["tui", "core"]) {
  test(`${runtime} snapshot admits spawn links and legacy colour witnesses only from its current owner`, async () => {
    for (const ready of [false, true])
      for (const matching of [false, true])
        for (const current of [false, true])
          for (const actionable of [false, true]) {
            const root = mkdtempSync(join(tmpdir(), "snapshot-runtime-"));
            try {
              const path = join(root, "board.json");
              const saved = emptyBoardDocument();
              saved.layout.colors["alpha:tab-1"] = "teal";
              writeFileSync(path, JSON.stringify(saved));
              const board = new BoardStore(path);
              const errors: unknown[] = [],
                warnings: unknown[] = [];
              const lease = {
                generation: matching ? 3 : 4,
                isCurrent: () => current,
                runtime: { core: { actionable } },
              };
              const owner = {
                has: (id: string) => id === "alpha",
                readyRuntimeLease: (id: string) => {
                  expect(id).toBe("alpha");
                  return ready ? lease : null;
                },
              };
              const wrongOwner = {
                // Deliberately overlap IDs: an unavailable core never falls back.
                has: () => true,
                readyRuntimeLease: () => {
                  throw new Error("Core must never use TUI manager");
                },
              };
              const ws = {};
              await handleWorldRpc({
                id: "snapshot",
                method: "world.snapshot",
                params: {},
                req: { id: "snapshot", method: "world.snapshot" },
                ws,
                services: {
                  clock: systemClock,
                  board: () => board,
                  clients: new Set([ws]),
                  safeSend: () => true,
                  publishBoardChanged: () => {},
                  logger: {
                    warn: (_message: string, error: unknown) =>
                      warnings.push(error),
                  },
                  connectionManager: runtime === "tui" ? owner : wrongOwner,
                  ...(runtime === "core"
                    ? { coreControl: { manager: owner } }
                    : {}),
                  worldSnapshots: {
                    observation: new WorldObservation("synthetic-service"),
                    snapshot: async () => ({
                      revision: 1,
                      observed_at: 1,
                      connections: [
                        {
                          connection_id: "alpha",
                          generation: 3,
                          snapshot_generation: 3,
                          state: "ready",
                          stale: false,
                          actionable: true,
                          snapshot: {
                            panes: [
                              {
                                pane_id: "parent",
                                terminal_id: "parent-terminal",
                                tab_id: "tab-1",
                              },
                              {
                                pane_id: "child",
                                terminal_id: "child-terminal",
                                tab_id: "tab-1",
                                tokens: {
                                  spawned_by: "parent",
                                  spawned_by_terminal: "parent-terminal",
                                },
                              },
                            ],
                            tabs: [{ tab_id: "tab-1" }],
                            workspaces: [{ workspace_id: "room-1" }],
                            agents: [],
                            coverage: { panes: 2, tabs: 1, workspaces: 1 },
                          },
                        },
                      ],
                    }),
                  },
                },
                sendReply: () => true,
                sendError: (_context: string, error: unknown) =>
                  errors.push(error),
              } as unknown as BridgeRpcContext);
              const admitted =
                ready &&
                matching &&
                current &&
                (runtime === "tui" || actionable);
              expect(errors).toEqual([]);
              expect(warnings).toEqual([]);
              expect(board.get().relations.spawns).toHaveLength(
                admitted ? 1 : 0,
              );
              expect(Object.values(board.get().appearance ?? {})).toHaveLength(
                admitted ? 1 : 0,
              );
              expect(board.get().layout.colors["alpha:tab-1"]).toBe("teal");
              if (admitted) {
                expect(board.get().relations.spawns[0]).toMatchObject({
                  child: {
                    connection_id: "alpha",
                    terminal_id: "child-terminal",
                  },
                  parent: {
                    connection_id: "alpha",
                    terminal_id: "parent-terminal",
                  },
                });
                expect(Object.values(board.get().appearance!)[0]).toMatchObject(
                  {
                    connection_id: "alpha",
                    witness: ["child-terminal", "parent-terminal"],
                  },
                );
              }
            } finally {
              rmSync(root, { recursive: true, force: true });
            }
          }
  });
}
