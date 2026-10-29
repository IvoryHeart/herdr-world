import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearTabLayouts,
  drawableTabLayout,
  retainTabLayoutOwners,
  forgetTabLayoutsExcept,
  provisionalTabLayout,
  rememberTabLayout,
  tabLayoutFor,
} from "./tabLayout";
import type { Pane, PaneLayout } from "./types";

function pane(paneId: string, tabId: string): Pane {
  return {
    pane_id: paneId,
    terminal_id: `terminal-${paneId}`,
    workspace_id: "w1",
    tab_id: tabId,
    focused: false,
    cwd: "/repos/w1",
    agent_status: "unknown",
    revision: 1,
  };
}

function layout(tabId: string, paneIds: string[]): PaneLayout {
  return {
    workspace_id: "w1",
    tab_id: tabId,
    zoomed: false,
    area: { x: 0, y: 0, width: 100, height: 40 },
    focused_pane_id: paneIds[0],
    panes: paneIds.map((paneId, index) => ({
      pane_id: paneId,
      focused: index === 0,
      rect: { x: index * 50, y: 0, width: 50, height: 40 },
    })),
    splits: [],
  };
}

describe("tab layout cache", () => {
  beforeEach(clearTabLayouts);

  test("keeps one entry per tab within a connection generation", () => {
    rememberTabLayout("c1", 1, layout("t1", ["p1"]));
    rememberTabLayout("c1", 2, layout("t1", ["p2"]));

    expect(tabLayoutFor("c1", 1, "t1")?.panes[0].pane_id).toBe("p1");
    expect(tabLayoutFor("c1", 2, "t1")?.panes[0].pane_id).toBe("p2");
    expect(tabLayoutFor("c2", 1, "t1")).toBeNull();
    expect(tabLayoutFor("c1", 1, undefined)).toBeNull();
  });

  test("drops tabs that a refresh no longer reports", () => {
    rememberTabLayout("c1", 1, layout("t1", ["p1"]));
    rememberTabLayout("c1", 1, layout("t2", ["p2"]));
    rememberTabLayout("c2", 1, layout("t2", ["p3"]));

    forgetTabLayoutsExcept("c1", 1, new Set(["t1"]));

    expect(tabLayoutFor("c1", 1, "t1")).not.toBeNull();
    expect(tabLayoutFor("c1", 1, "t2")).toBeNull();
    expect(tabLayoutFor("c2", 1, "t2")).not.toBeNull();
  });
});

describe("provisional tab layout", () => {
  test("reuses cached geometry while the tab holds the same panes", () => {
    const cached = layout("t1", ["p1", "p2"]);
    const panes = [pane("p2", "t1"), pane("p1", "t1")];

    expect(provisionalTabLayout(cached, panes, "t1")).toBe(cached);
  });

  test("rejects cached geometry once the tab gained or lost a pane", () => {
    const cached = layout("t1", ["p1", "p2"]);

    expect(
      provisionalTabLayout(
        cached,
        [pane("p1", "t1"), pane("p2", "t1"), pane("p3", "t1")],
        "t1",
      ),
    ).toBeNull();
    expect(
      provisionalTabLayout(cached, [pane("p1", "t1")], "t1"),
    ).not.toBeNull();
    expect(
      provisionalTabLayout(cached, [pane("p1", "t1")], "t1")?.panes,
    ).toEqual([
      {
        pane_id: "p1",
        focused: true,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    ]);
  });

  test("fills the tab with its only pane when nothing is cached", () => {
    const projected = provisionalTabLayout(
      null,
      [pane("p1", "t1"), pane("p9", "t2")],
      "t1",
    );

    expect(projected).toEqual({
      workspace_id: "w1",
      tab_id: "t1",
      zoomed: false,
      area: { x: 0, y: 0, width: 1, height: 1 },
      focused_pane_id: "p1",
      panes: [
        {
          pane_id: "p1",
          focused: true,
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
      splits: [],
    });
  });

  test("guesses nothing for an unvisited split or an empty tab", () => {
    expect(
      provisionalTabLayout(null, [pane("p1", "t1"), pane("p2", "t1")], "t1"),
    ).toBeNull();
    expect(provisionalTabLayout(null, [pane("p1", "t1")], "t2")).toBeNull();
    expect(
      provisionalTabLayout(null, [pane("p1", "t1")], undefined),
    ).toBeNull();
    expect(
      provisionalTabLayout(layout("t2", ["p1"]), [pane("p1", "t1")], "t1"),
    ).not.toBeNull();
  });
});

test("same-runtime unavailable owners keep geometry; replaced and removed owners retire it", () => {
  clearTabLayouts();
  const retained = layout("t1", ["p1", "p2"]);
  rememberTabLayout("alpha", 7, retained);
  rememberTabLayout("beta", 3, layout("t1", ["p3"]));
  retainTabLayoutOwners([
    { id: "alpha", generation: 7 },
    { id: "beta", generation: 3 },
  ]);
  expect(tabLayoutFor("alpha", 7, "t1")).toBe(retained);
  retainTabLayoutOwners([{ id: "alpha", generation: 8 }]);
  expect(tabLayoutFor("alpha", 7, "t1")).toBeNull();
  expect(tabLayoutFor("beta", 3, "t1")).toBeNull();
});

describe("drawable tab layout", () => {
  type Rect = PaneLayout["area"];
  const rect = (x: number, y: number, width: number, height: number): Rect => ({
    x,
    y,
    width,
    height,
  });
  // Herdr's own shape: splits named split_<depth>_<path from the root>, panes
  // in the tree's left-to-right order, all squeezed into a 10×1 tab.
  const squeezed = (
    splits: [string, "right" | "down", Rect][],
    panes: Rect[],
  ): PaneLayout => ({
    workspace_id: "w1",
    tab_id: "t1",
    zoomed: false,
    area: rect(0, 0, 10, 1),
    focused_pane_id: "p1",
    splits: splits.map(([id, direction, at]) => ({
      id,
      direction,
      ratio: 0.5,
      rect: at,
    })),
    panes: panes.map((at, index) => ({
      pane_id: `p${index + 1}`,
      focused: index === 0,
      rect: at,
    })),
  });
  const drawn = (layout: PaneLayout) =>
    drawableTabLayout(layout)?.panes.map((pane) => [
      pane.pane_id,
      pane.rect.x,
      pane.rect.y,
      pane.rect.width,
      pane.rect.height,
    ]);

  test("rebuilds a review round: the author beside a stack of reviewers", () => {
    const round = squeezed(
      [
        ["split_0_root", "right", rect(0, 0, 10, 1)],
        ["split_1_1", "down", rect(5, 0, 5, 1)],
        ["split_2_11", "down", rect(5, 1, 5, 0)],
      ],
      [rect(0, 0, 5, 1), rect(5, 0, 5, 1), rect(5, 1, 5, 0), rect(5, 1, 5, 0)],
    );
    expect(drawn(round)).toEqual([
      ["p1", 0, 0, 500, 1000],
      ["p2", 500, 0, 500, 500],
      ["p3", 500, 500, 500, 250],
      ["p4", 500, 750, 500, 250],
    ]);
    expect(drawableTabLayout(round)?.splits.map((split) => split.rect)).toEqual(
      [
        rect(0, 0, 1000, 1000),
        rect(500, 0, 500, 1000),
        rect(500, 500, 500, 500),
      ],
    );
    expect(drawableTabLayout(round)?.area).toEqual(rect(0, 0, 1000, 1000));
  });

  test("rebuilds a split nested in the first side", () => {
    const nested = squeezed(
      [
        ["split_0_root", "right", rect(0, 0, 10, 1)],
        ["split_1_0", "right", rect(0, 0, 5, 1)],
        ["split_1_1", "down", rect(5, 0, 5, 1)],
      ],
      [rect(0, 0, 3, 1), rect(3, 0, 2, 1), rect(5, 0, 5, 1), rect(5, 1, 5, 0)],
    );
    expect(drawn(nested)).toEqual([
      ["p1", 0, 0, 250, 1000],
      ["p2", 250, 0, 250, 1000],
      ["p3", 500, 0, 500, 500],
      ["p4", 500, 500, 500, 500],
    ]);
  });

  test("keeps real geometry and refuses geometry it cannot draw", () => {
    const shown = layout("t1", ["p1", "p2"]);
    expect(drawableTabLayout(shown)).toBe(shown);
    const pane = [rect(0, 0, 5, 1), rect(5, 1, 5, 0)];
    const root: [string, "right", Rect] = [
      "split_0_root",
      "right",
      rect(0, 0, 10, 1),
    ];
    // Unknown split names, a split off the tree, or too few panes.
    expect(
      drawableTabLayout(squeezed([["s", "right", rect(0, 0, 10, 1)]], pane)),
    ).toBeNull();
    expect(
      drawableTabLayout(
        squeezed(
          [root, ["split_2_10", "down", rect(5, 0, 5, 1)]],
          [...pane, pane[1]!],
        ),
      ),
    ).toBeNull();
    expect(
      drawableTabLayout(
        squeezed([root, ["split_1_1", "down", rect(5, 0, 5, 1)]], pane),
      ),
    ).toBeNull();
  });
});
