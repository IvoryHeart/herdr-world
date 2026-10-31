import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage } from "./storage";
import { systemClock, systemScheduler } from "./ports";
import { emptyBoardDocument } from "../world/board-store";
import { interestKey } from "../../../shared/interest";

const ports = { clock: systemClock, scheduler: systemScheduler };
test("legacy bindings persist through the root; moves retain IDs and layout reuse claims no identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "binding-root-"));
  const paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
  const document = emptyBoardDocument();
  document.layout.anchors["studio:workspace-a"] = { x: 10, y: 20 };
  document.layout.colors["studio:workspace-a"] = "blue";
  document.layout.interest[interestKey("studio", "terminal-a")] = "muted";
  document.notes.push({
    id: "legacy-note",
    text: "Fixture",
    color: "yellow",
    x: 0,
    y: 0,
    rev: 0,
  });
  document.strings.push({
    id: "legacy-string",
    from: { note: "legacy-note" },
    to: {
      anchor: {
        connection_id: "studio",
        kind: "workspace",
        native_id: "workspace-a",
        witness: ["terminal-a"],
      },
    },
  });
  mkdirSync(dirname(paths.board), { recursive: true });
  writeFileSync(paths.board, JSON.stringify(document));
  const storage = await openStorage(paths, ports);
  let reopened: Awaited<ReturnType<typeof openStorage>> | undefined;
  try {
    const board = storage.board();
    const target = {
      connection_id: "studio",
      kind: "pane" as const,
      native_id: "pane-a",
      witness: ["terminal-a"],
    };
    board.patch([{ op: "appearance.set", target, fields: {} }]);
    const before = await storage.bindings.list();
    expect(before).toHaveLength(3);
    const string = before.find((binding) => binding.policy === "board-string")!;
    const look = before.find((binding) => binding.policy === "appearance")!;
    expect(string.record_id).toBe("legacy-string");
    expect(look.record_id).toMatch(/^n-[0-9a-z]{8}$/);
    expect(
      before.filter((binding) => binding.native_id === "workspace-a"),
    ).toHaveLength(1);
    const fence = {
      adapter: "herdr",
      instance: "studio",
      service_incarnation: "service-a",
      generation: 1,
    };
    const reused = await storage.bindings.resolve(
      string.id,
      {
        type: "listing",
        fence,
        complete: true,
        entities: [{ native_id: "workspace-a", terminals: ["terminal-b"] }],
      },
      fence,
      string.revision,
    );
    expect(reused?.binding.state).toBe("unconfirmed");
    expect(reused?.target).toBeNull();
    expect(board.get().layout.anchors["studio:workspace-a"]).toEqual({
      x: 10,
      y: 20,
    });
    expect(board.get().layout.colors["studio:workspace-a"]).toBe("blue");
    await storage.bindings.resolve(
      string.id,
      { type: "absence", via: "close", native_id: "workspace-a", fence },
      fence,
      reused!.binding.revision,
    );
    board.patch([
      {
        op: "appearance.relocate",
        from: target,
        target: { ...target, native_id: "pane-b" },
      },
    ]);
    const after = (await storage.bindings.list()).find(
      (binding) => binding.policy === "appearance",
    )!;
    expect(after).toMatchObject({
      id: look.id,
      record_id: look.record_id,
      native_id: "pane-b",
      state: "unresolved",
    });
    expect((await storage.bindings.get(string.id))?.state).toBe("ended");
    await storage.close();
    reopened = await openStorage(paths, ports);
    expect((await reopened.bindings.get(look.id))?.native_id).toBe("pane-b");
    reopened.board(); // Re-import remains idempotent and preserves the record identity.
    expect(
      (await reopened.bindings.list()).find(
        (binding) => binding.policy === "appearance",
      )?.id,
    ).toBe(look.id);
  } finally {
    await storage.close();
    await reopened?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a layout-only Board creates no bindings or identity claim", async () => {
  const root = mkdtempSync(join(tmpdir(), "binding-layout-"));
  const paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
  const document = emptyBoardDocument();
  document.layout.pinned["studio:workspace-a"] = { x: 1, y: 2 };
  document.layout.folded.push("studio:workspace-a");
  document.layout.colors["studio:workspace-a"] = "blue";
  mkdirSync(dirname(paths.board), { recursive: true });
  writeFileSync(paths.board, JSON.stringify(document));
  const storage = await openStorage(paths, ports);
  try {
    storage.board();
    expect(await storage.bindings.list()).toEqual([]);
  } finally {
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});
