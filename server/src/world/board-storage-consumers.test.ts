import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage } from "../service/storage";
import { resolveDataPaths } from "../config/data-paths";
import { systemClock, systemScheduler } from "../service/ports";
import { fakeHerdr } from "./testing/deskMoveFixture";
import { executeTownMove } from "./town-move";
import { appearanceFor } from "../../../shared/appearance";
import { createBoardChange } from "./world-cli-board-change";
import type { WorldCliDeps } from "./world-cli";
import { StorageWriteRejected } from "../storage/world-protocol";

test("a move re-probes after a queued unacknowledged appearance edit and preserves the explicit fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-move-storage-"));
  const store = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  try {
    const board = store.board(),
      herdr = fakeHerdr({});
    const source = herdr.addTab("w1", "Source", 2);
    herdr.addTab("w1", "Keep room", 1);
    herdr.addTab("w2", "Target", 1);
    const terminals = source.ids.map((id) => herdr.panes.get(id)!.terminal),
      target = {
        connection_id: "studio",
        kind: "tab" as const,
        native_id: source.tab,
        witness: terminals,
        color_key: `studio:${source.tab}`,
      };
    await board.patch([
      {
        op: "appearance.set",
        target,
        fields: { color: "pink", status: "Before move" },
      },
    ]);
    const errors: unknown[] = [],
      published: number[] = [];
    let edited = false,
      probes = 0,
      edit: ReturnType<typeof board.patch> | undefined,
      destination: typeof target | undefined;
    const result = await executeTownMove(
      {
        connectionId: "studio",
        generation: 1,
        isCurrent: () => true,
        queues: new Map(),
        board,
        publishBoard: (revision) => published.push(revision),
        onFollowError: (error) => errors.push(error),
        call: async (method, params) => {
          if (method === "workspace.list") {
            if (herdr.moves() > 0) {
              probes++;
              if (!edited) {
                edited = true;
                const pane = [...herdr.panes.values()].find(
                  (p) => p.terminal === terminals[0],
                )!;
                destination = {
                  ...target,
                  native_id: pane.tab,
                  color_key: `studio:${pane.tab}`,
                };
                edit = board.patch([
                  {
                    op: "appearance.set",
                    target: destination,
                    fields: {
                      color: "teal",
                      status: "Queued destination edit",
                    },
                  },
                ]);
              }
            }
            return {
              workspaces: [{ workspace_id: "w1" }, { workspace_id: "w2" }],
            };
          }
          return herdr.call(method, params);
        },
      },
      { kind: "desk", tab_id: source.tab, workspace_id: "w2" },
    );
    await edit;
    expect(result.status).toBe("moved");
    expect(errors).toEqual([]);
    expect(probes).toBeGreaterThanOrEqual(2);
    expect(appearanceFor(board.get().appearance, destination!)?.status).toBe(
      "Queued destination edit",
    );
    expect(board.get().layout.colors[destination!.color_key]).toBe("teal");
    expect(published).toHaveLength(1);
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("CLI history refusal cannot compensate over a browser edit already admitted to SQLite", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-undo-storage-"));
  const store = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  try {
    const board = store.board(),
      deps = { board } as unknown as WorldCliDeps;
    const change = createBoardChange(
      deps,
      (_deps, ops) => board.patch(ops),
      (_deps, revision, ops) => board.patchIf(revision, ops),
    );
    let browser: ReturnType<typeof board.patch> | undefined;
    const result = await Promise.allSettled([
      change(
        deps,
        { label: "Synthetic actor", verified: false },
        [{ op: "card.color", key: "studio:workspace-a", color: "pink" }],
        [{ op: "card.color", key: "studio:workspace-a", color: null }],
        () => {
          browser = board.patch([
            { op: "card.color", key: "studio:workspace-a", color: "teal" },
          ]);
          throw new StorageWriteRejected("Synthetic history refusal");
        },
      ),
    ]);
    await browser;
    expect(result[0]!.status).toBe("rejected");
    expect((result[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      StorageWriteRejected,
    );
    expect(board.get().layout.colors["studio:workspace-a"]).toBe("teal");
    expect(board.get().revision).toBe(2);
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
