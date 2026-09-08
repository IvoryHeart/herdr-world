// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_VIEW_PREFS,
  TREE_VIEW_PREFS_KEY,
  parseTreeViewPrefs,
  readTreeViewPrefs,
  writeTreeViewPrefs,
} from "./treeViewPrefs";

beforeEach(() => window.localStorage.clear());

describe("Tree view preferences", () => {
  it("round-trips only through its Tree-specific key", () => {
    window.localStorage.setItem("herdr.world.graph-view.v2", "graph-unchanged");
    writeTreeViewPrefs({ camera: { x: 12, y: -8, zoom: 1.4 }, collapsedIds: ["host", "space"] });
    expect(readTreeViewPrefs()).toEqual({
      camera: { x: 12, y: -8, zoom: 1.4 },
      collapsedIds: ["host", "space"],
    });
    expect(window.localStorage.getItem("herdr.world.graph-view.v2")).toBe("graph-unchanged");
    expect(window.localStorage.getItem(TREE_VIEW_PREFS_KEY)).not.toBeNull();
  });

  it("bounds malformed cameras and collapse identities", () => {
    const collapsedIds = Array.from({ length: 2400 }, (_, index) => `node-${index}`);
    const parsed = parseTreeViewPrefs({
      camera: { x: Number.POSITIVE_INFINITY, y: 2_000_000, zoom: 99 },
      collapsedIds: ["", "ok", "ok", "x".repeat(513), ...collapsedIds],
    });
    expect(parsed.camera).toEqual(DEFAULT_TREE_VIEW_PREFS.camera);
    expect(parsed.collapsedIds[0]).toBe("ok");
    expect(parsed.collapsedIds).toHaveLength(2304);
  });
});
