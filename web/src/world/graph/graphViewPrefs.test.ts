// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  GRAPH_VIEW_PREFS_KEY,
  parseGraphViewPrefs,
  readInitialGraphViewPrefs,
  readGraphViewPrefs,
  writeGraphViewPrefs,
} from "./graphViewPrefs";

beforeEach(() => window.localStorage.clear());

describe("Graph view preferences", () => {
  it("round-trips bounded camera, collapse, and pinned layout state", () => {
    writeGraphViewPrefs({
      camera: { x: 12, y: -30, zoom: 1.5 },
      collapsedIds: ["space", "space"],
      positions: { agent: { x: 4, y: 8, pinned: true } },
    });
    expect(readGraphViewPrefs()).toEqual({
      camera: { x: 12, y: -30, zoom: 1.5 },
      collapsedIds: ["space"],
      positions: { agent: { x: 4, y: 8, pinned: true } },
    });
  });

  it("fails malformed or out-of-range fields to safe defaults", () => {
    expect(parseGraphViewPrefs({
      camera: { x: Number.POSITIVE_INFINITY, y: "bad", zoom: 99 },
      collapsedIds: ["ok", 2, ""],
      positions: {
        ok: { x: 1, y: 2, pinned: false },
        bad: { x: 2_000_000, y: 0, pinned: true },
      },
    })).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      collapsedIds: ["ok"],
      positions: { ok: { x: 1, y: 2, pinned: false } },
    });
    window.localStorage.setItem(GRAPH_VIEW_PREFS_KEY, "not json");
    expect(readGraphViewPrefs()).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      collapsedIds: [],
      positions: {},
    });
  });

  it("fits a fresh or malformed view but preserves a valid saved camera", () => {
    expect(readInitialGraphViewPrefs()).toMatchObject({ fitOnMount: true });

    window.localStorage.setItem(GRAPH_VIEW_PREFS_KEY, JSON.stringify({ camera: "bad" }));
    expect(readInitialGraphViewPrefs()).toMatchObject({ fitOnMount: true });

    writeGraphViewPrefs({
      camera: { x: 0, y: 0, zoom: 1 },
      collapsedIds: [],
      positions: {},
    });
    expect(readInitialGraphViewPrefs()).toMatchObject({ fitOnMount: true });

    writeGraphViewPrefs({
      camera: { x: 12, y: -30, zoom: 1.5 },
      collapsedIds: [],
      positions: {},
    });
    expect(readInitialGraphViewPrefs()).toMatchObject({
      fitOnMount: false,
      prefs: { camera: { x: 12, y: -30, zoom: 1.5 } },
    });
  });
});
