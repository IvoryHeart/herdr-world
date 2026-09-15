// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  boundTreeCamera,
  DEFAULT_TREE_VIEW_PREFS,
  fitTreeCamera,
  TREE_MAX_ZOOM,
  TREE_MIN_ZOOM,
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

  it("bounds runtime cameras to scaled map geometry", () => {
    const geometry = { viewportWidth: 600, viewportHeight: 400, mapWidth: 1_000, mapHeight: 800 };
    expect(boundTreeCamera({ x: 50_000, y: -50_000, zoom: 8 }, geometry)).toEqual({
      x: 16,
      y: -1_616,
      zoom: TREE_MAX_ZOOM,
    });
    expect(boundTreeCamera({ x: -50_000, y: 50_000, zoom: 0.01 }, geometry)).toEqual({
      x: 100,
      y: 40,
      zoom: TREE_MIN_ZOOM,
    });
  });

  it("fits a map within the padded viewport and zoom bounds", () => {
    expect(fitTreeCamera({
      viewportWidth: 600,
      viewportHeight: 400,
      mapWidth: 1_000,
      mapHeight: 800,
    })).toEqual({ x: 70, y: 16, zoom: 0.46 });
  });
});
