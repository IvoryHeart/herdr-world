import { planBoardPatch } from "../world/board-plan";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage, type WorldStorage } from "../service/storage";
import { resolveDataPaths } from "../config/data-paths";
import { systemClock, systemScheduler } from "../service/ports";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";
import type { BoardDocument } from "../world/board-store";
import { pruneGoneAppearance } from "../world/appearance-prune";

const roots: string[] = [],
  stores: WorldStorage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "board-rpc-storage-"));
  roots.push(root);
  const store = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  stores.push(store);
  const replies: { result: { document: BoardDocument; conflict?: string } }[] =
      [],
    errors: unknown[] = [],
    published: number[] = [];
  let current = true;
  const rpc = (ops: unknown, revision?: number) =>
    handleWorldRpc({
      id: "synthetic-request",
      method: "world.board.patch",
      params: { ops, revision },
      requestIsCurrent: () => current,
      services: {
        board: () => store.board(),
        bindings: store.bindings,
        publishBoardChanged: (revision: number) => published.push(revision),
        bindBoardRecipients: async () => {},
        logger: { warn: () => {} },
      },
      sendReply: (reply: (typeof replies)[number]) => {
        replies.push(reply);
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        errors.push(error);
      },
    } as unknown as BridgeRpcContext);
  return {
    store,
    rpc,
    replies,
    errors,
    published,
    retire: () => {
      current = false;
    },
    isCurrent: () => current,
  };
}
const note = {
  id: "note-a",
  text: "Synthetic draft",
  color: "yellow",
  x: 1,
  y: 2,
};
test("the real Board RPC acknowledges only committed edits and preserves note and Group conflict wire responses", async () => {
  const f = await fixture(),
    board = f.store.board();
  const pending = f.rpc([{ op: "note.put", note }]);
  expect(f.replies).toEqual([]);
  expect(f.published).toEqual([]);
  expect(board.get().revision).toBe(0);
  await pending;
  const created = f.replies[0]!.result.document;
  expect(board.get()).toEqual(created);
  expect(f.published).toEqual([1]);
  await Promise.all([
    f.rpc([
      {
        op: "note.put",
        note: { ...note, text: "Committed edit" },
        rev: created.notes[0]!.rev,
      },
    ]),
    f.rpc([
      {
        op: "note.put",
        note: { ...note, text: "Kept stale draft" },
        rev: created.notes[0]!.rev,
      },
    ]),
  ]);
  expect(f.replies[2]!.result.conflict).toContain("changed");
  expect(f.replies[2]!.result.document.notes[0]!.text).toBe("Committed edit");
  const reviewed = board.get().revision;
  await f.rpc(
    [
      {
        op: "group.create",
        id: "group-a",
        kind: "pod",
        name: "Synthetic Group",
      },
    ],
    reviewed,
  );
  await f.rpc([{ op: "group.delete", id: "group-a" }], reviewed);
  expect(f.replies[4]!.result.conflict).toContain("changed");
  expect(board.get().relations.groups).toHaveLength(1);
  const before = board.get();
  await f.rpc([
    { op: "note.put", note: { ...note, id: "note-b" } },
    { op: "spawn.record", claims: [] },
  ]);
  expect(f.errors).toHaveLength(1);
  expect(board.get()).toEqual(before);
  expect(f.published).toEqual([1, 2, 3]);
});
test("queued RPC admission and destructive pruning recheck runtime authority before mutation", async () => {
  const f = await fixture(),
    board = f.store.board();
  await board.patch([
    {
      op: "appearance.set",
      target: {
        connection_id: "studio",
        kind: "pane",
        native_id: "pane-a",
        witness: ["terminal-a"],
      },
      fields: { avatar: "builder" },
    },
  ]);
  const before = board.get();
  const retire = board.patch(
    planBoardPatch([], () => {
      f.retire();
      return null;
    }),
  );
  const rpc = f.rpc([{ op: "note.put", note }]);
  await Promise.all([retire, rpc]);
  expect(f.errors).toHaveLength(1);
  expect(f.replies).toEqual([]);
  expect(board.get()).toEqual(before);
  let live = true;
  await pruneGoneAppearance(board, "studio", {
    isCurrent: () => live,
    call: async () => {
      void board.patch(
        planBoardPatch([], () => {
          live = false;
          return null;
        }),
      );
      return { panes: [] };
    },
    changed: (revision) => f.published.push(revision),
  });
  expect(board.get()).toEqual(before);
  expect(f.published).toEqual([]);
});
