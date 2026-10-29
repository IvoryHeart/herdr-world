import { capturedMoveColors } from "./appearance-move";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore, clientBoardOps, moveFollowOps } from "./board-store";
import {
  appearanceKey,
  appearanceFor,
  parseAppearanceRecords,
} from "../../../shared/appearance";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const tab = {
  connection_id: "alpha",
  kind: "tab" as const,
  native_id: "tab-1",
  witness: ["terminal-1"],
  color_key: "alpha:tab-1",
};
const pane = {
  connection_id: "alpha",
  kind: "pane" as const,
  native_id: "pane-1",
  witness: ["terminal-1"],
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-appearance-"));
  roots.push(root);
  const path = join(root, "board.json");
  return { path, store: new BoardStore(path) };
}

test("one colour source, field patches, restart and independent pane avatars", () => {
  const { store, path } = fixture();
  store.patch([{ op: "card.color", key: tab.color_key, color: "pink" }]);
  store.patch([
    {
      op: "appearance.set",
      target: tab,
      fields: { status: "Checking results" },
    },
  ]);
  store.patch([
    { op: "appearance.set", target: tab, fields: { color: "teal" } },
  ]);
  store.patch([
    { op: "appearance.set", target: pane, fields: { avatar: "builder" } },
  ]);
  store.patch([
    {
      op: "appearance.set",
      target: { ...pane, native_id: "pane-2", witness: ["terminal-2"] },
      fields: { avatar: "designer" },
    },
  ]);
  const saved = new BoardStore(path).get();
  expect(saved.layout.colors[tab.color_key]).toBe("teal");
  expect(appearanceFor(saved.appearance, tab)?.status).toBe("Checking results");
  expect(appearanceFor(saved.appearance, pane)?.avatar).toBe("builder");
  expect(
    saved.appearance?.[appearanceKey({ ...pane, native_id: "pane-2" })]?.avatar,
  ).toBe("designer");
  expect(appearanceFor(saved.appearance, tab)).not.toHaveProperty("color");
  store.patch([
    { op: "appearance.set", target: pane, fields: { avatar: null } },
  ]);
  expect(appearanceFor(store.get().appearance, pane)?.avatar).toBeUndefined();
});

test("reused IDs and other connections cannot inherit bound choices", () => {
  const { store } = fixture();
  store.patch([
    {
      op: "appearance.set",
      target: tab,
      fields: { color: "pink", status: "Previous occupant" },
    },
  ]);
  const replacement = { ...tab, witness: ["replacement-terminal"] };
  expect(appearanceFor(store.get().appearance, replacement)).toBeNull();
  expect(
    appearanceFor(store.get().appearance, { ...tab, connection_id: "beta" }),
  ).toBeNull();
  store.patch([
    {
      op: "appearance.set",
      target: replacement,
      fields: { status: "New occupant" },
    },
  ]);
  expect(store.get().layout.colors[tab.color_key]).toBeUndefined();
  expect(appearanceFor(store.get().appearance, replacement)?.status).toBe(
    "New occupant",
  );
});

test("appearance parsing rejects malformed and unbounded persisted data", () => {
  for (const fields of [
    { status: "x".repeat(161) },
    { avatar: "upload://custom" },
    { status: "line\ncontrol" },
    { color: "pink" },
  ]) {
    expect(() =>
      parseAppearanceRecords({ [appearanceKey(tab)]: { ...tab, ...fields } }),
    ).toThrow();
  }
  expect(() => parseAppearanceRecords({ wrong: tab })).toThrow();
  expect(() =>
    parseAppearanceRecords({ [appearanceKey(tab)]: { ...tab, witness: [] } }),
  ).toThrow();
});

test("browser Board patches cannot bypass qualified appearance admission", () => {
  expect(() =>
    clientBoardOps([{ op: "appearance.prune", keys: [appearanceKey(tab)] }]),
  ).toThrow();
  expect(() =>
    clientBoardOps([
      { op: "appearance.set", target: tab, fields: { status: "Bypass" } },
    ]),
  ).toThrow();
});

test("legacy browser colour operations cannot bypass a migrated tab binding", () => {
  const { store } = fixture();
  store.patch([
    { op: "appearance.set", target: tab, fields: { color: "pink" } },
  ]);
  expect(() =>
    clientBoardOps(
      [{ op: "card.color", key: tab.color_key, color: "teal" }],
      store.get(),
    ),
  ).toThrow("qualified appearance admission");
  expect(
    clientBoardOps(
      [{ op: "card.color", key: "alpha:workspace-1", color: "teal" }],
      store.get(),
    ).ops,
  ).toHaveLength(1);
});

test("persisted shared fields and colour follow a confirmed native move", () => {
  const { store } = fixture();
  store.patch([
    {
      op: "appearance.set",
      target: tab,
      fields: { color: "pink", status: "Continuing work" },
    },
    { op: "appearance.set", target: pane, fields: { avatar: "builder" } },
  ]);
  const before = store.get();
  store.patch(
    moveFollowOps(
      before,
      "alpha",
      "tab-1",
      {
        tab_id: "tab-2",
        workspace_id: "space-2",
        source_workspace_id: "space-1",
        panes: [{ previous: "pane-1", current: "pane-2" }],
      },
      {
        before: before.layout.colors,
        workspaceIds: new Set(["space-1", "space-2"]),
      },
    ),
  );
  const saved = store.get();
  expect(saved.layout.colors["alpha:tab-2"]).toBe("pink");
  expect(saved.layout.colors[tab.color_key]).toBeUndefined();
  expect(
    appearanceFor(saved.appearance, {
      ...tab,
      native_id: "tab-2",
      color_key: "alpha:tab-2",
    })?.status,
  ).toBe("Continuing work");
  expect(
    appearanceFor(saved.appearance, { ...pane, native_id: "pane-2" })?.avatar,
  ).toBe("builder");
});

test("a moving tab keeps explicit concurrent colour/reset intent while native close cleanup preserves its captured choice", () => {
  const { store } = fixture();
  store.patch([
    { op: "appearance.set", target: tab, fields: { color: "pink" } },
  ]);
  const before = store.get();
  const changed = store.captureColorChanges();
  store.patch([{ op: "card.color", key: tab.color_key, color: null }]);
  expect(
    capturedMoveColors(before.layout.colors, store.get(), "alpha", changed)[
      tab.color_key
    ],
  ).toBe("pink");
  store.patch([{ op: "appearance.set", target: tab, fields: { color: null } }]);
  expect(
    capturedMoveColors(before.layout.colors, store.get(), "alpha", changed)[
      tab.color_key
    ],
  ).toBeUndefined();
  store.patch([
    { op: "appearance.set", target: tab, fields: { color: "teal" } },
  ]);
  expect(
    capturedMoveColors(before.layout.colors, store.get(), "alpha", changed)[
      tab.color_key
    ],
  ).toBe("teal");
});
