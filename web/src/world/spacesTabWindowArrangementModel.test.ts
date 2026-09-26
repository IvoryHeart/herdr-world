import { describe, expect, test } from "bun:test";
import type { Tab, Workspace } from "../types";
import {
  availableSpacesWindowStage,
  clampSpacesTabWindowGeometry,
  orderedSpacesTabs,
  spacesTabWindowContext,
  spacesTabWindowEntries,
} from "./spacesTabWindowArrangementModel";
import type { TerminalWindowArrangementScope } from "./terminalWindowArrangementState";

const workspace = (
  id: string,
  focused: boolean,
  activeTabId?: string,
): Workspace => ({
  workspace_id: id,
  number: 1,
  label: id,
  focused,
  pane_count: 2,
  tab_count: 2,
  active_tab_id: activeTabId,
  agent_status: "idle",
});
const tab = (id: string, workspaceId: string, focused = false): Tab => ({
  tab_id: id,
  workspace_id: workspaceId,
  number: 1,
  label: id,
  focused,
  pane_count: 1,
  agent_status: "idle",
});

const tabs = [
  tab("one", "alpha"),
  tab("two", "alpha", true),
  tab("elsewhere", "beta"),
];
const stage = { width: 1000, height: 800 };
const scope: TerminalWindowArrangementScope<"native-single" | "floating"> = {
  preset: "columns",
  restorePreset: "single",
  baselines: {},
  placements: [
    {
      id: "one",
      geometry: { left: 0, top: 0, width: 496, height: 800 },
    },
    {
      id: "two",
      geometry: { left: 504, top: 0, width: 496, height: 800 },
    },
  ],
};

describe("Spaces tab window arrangement model", () => {
  test("keeps a compact arranged tile within the stage during geometry updates", () => {
    expect(
      clampSpacesTabWindowGeometry(
        { left: 750, top: 50, width: 240, height: 200 },
        stage,
      ),
    ).toEqual({ left: 750, top: 50, width: 240, height: 200 });
  });

  test("subtracts a visible overlay Inspector but keeps an adjacent dock's stage", () => {
    const layer = {
      left: 0,
      top: 50,
      right: 900,
      bottom: 650,
      width: 900,
      height: 600,
    };
    const rightOverlay = {
      left: 340,
      top: 50,
      right: 900,
      bottom: 650,
      width: 560,
      height: 600,
    };
    expect(
      availableSpacesWindowStage(
        { width: 900, height: 600 },
        layer,
        rightOverlay,
        "right",
      ),
    ).toEqual({ width: 340, height: 600 });
    expect(
      availableSpacesWindowStage(
        { width: 900, height: 600 },
        layer,
        { ...rightOverlay, left: 900, right: 1460 },
        "right",
      ),
    ).toEqual({ width: 900, height: 600 });
    expect(
      availableSpacesWindowStage(
        { width: 900, height: 600 },
        layer,
        { ...rightOverlay, left: 0, top: 450, right: 900 },
        "bottom",
      ),
    ).toEqual({ width: 900, height: 400 });
  });
  test("selects only existing tabs in the focused workspace and generation", () => {
    expect(
      spacesTabWindowContext({
        activeConnectionId: "connection-a",
        serverRuntimeGeneration: 7,
        workspaces: [workspace("alpha", true, "one"), workspace("beta", false)],
        tabs,
      }),
    ).toEqual({
      leaseKey: JSON.stringify(["connection-a", 7]),
      scopeKey: "spaces:alpha",
      workspaceId: "alpha",
      activeTabId: "one",
      tabs: tabs.slice(0, 2),
    });
    expect(
      spacesTabWindowContext({
        activeConnectionId: "connection-a",
        serverRuntimeGeneration: null,
        workspaces: [workspace("alpha", true)],
        tabs,
      }),
    ).toBeNull();
  });

  test("falls back to the focused tab then first open tab", () => {
    const base = {
      activeConnectionId: "connection-a",
      serverRuntimeGeneration: 7,
      workspaces: [workspace("alpha", true, "closed")],
      tabs,
    };
    expect(spacesTabWindowContext(base)?.activeTabId).toBe("two");
    expect(
      spacesTabWindowContext({
        ...base,
        tabs: [tab("one", "alpha"), tab("two", "alpha")],
      })?.activeTabId,
    ).toBe("one");
  });

  test("raises the active tab without changing other focus order", () => {
    const ordered = orderedSpacesTabs(
      [tab("one", "alpha"), tab("two", "alpha"), tab("three", "alpha")],
      ["three", "one"],
      "two",
    );
    expect(ordered.map(({ tab_id }) => tab_id)).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  test("keeps new tabs floating alongside one-shot tiled participants", () => {
    const entries = spacesTabWindowEntries({
      scope,
      tabs: [...tabs.slice(0, 2), tab("three", "alpha")],
      activeTabId: "three",
      raisedIds: [],
      freeGeometry: {
        three: { left: 120, top: 100, width: 520, height: 400 },
      },
      stage,
      compact: false,
    });
    expect(entries.map(({ tab: current }) => current.tab_id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(entries[0]?.geometry).toEqual(scope.placements[0]?.geometry);
    expect(entries[2]?.geometry).toEqual({
      left: 120,
      top: 100,
      width: 520,
      height: 400,
    });
    expect(scope.placements).toHaveLength(2);
  });

  test("preserves desktop placements while compact and resolves a smaller stage without overlap", () => {
    const tiny = spacesTabWindowEntries({
      scope,
      tabs: tabs.slice(0, 2),
      activeTabId: "two",
      raisedIds: [],
      freeGeometry: {},
      stage: { width: 390, height: 700 },
      compact: true,
    });
    expect(tiny).toEqual([]);
    const narrower = spacesTabWindowEntries({
      scope,
      tabs: tabs.slice(0, 2),
      activeTabId: "two",
      raisedIds: [],
      freeGeometry: {},
      stage: { width: 500, height: 600 },
      compact: false,
    });
    expect(narrower).toHaveLength(2);
    expect(narrower[0]?.geometry).toEqual({
      left: 0,
      top: 0,
      width: 246,
      height: 600,
    });
    expect(narrower[1]?.geometry).toEqual({
      left: 254,
      top: 0,
      width: 246,
      height: 600,
    });
    const resized = spacesTabWindowEntries({
      scope,
      tabs: tabs.slice(0, 2),
      activeTabId: "two",
      raisedIds: [],
      freeGeometry: {},
      stage: { width: 700, height: 600 },
      compact: false,
    });
    expect(resized).toHaveLength(2);
    expect(resized[0]?.geometry).toEqual({
      left: 0,
      top: 0,
      width: 346,
      height: 600,
    });
    expect(resized[1]?.geometry).toEqual({
      left: 354,
      top: 0,
      width: 346,
      height: 600,
    });
    expect(
      resized[1]!.geometry.left + resized[1]!.geometry.width,
    ).toBeLessThanOrEqual(700);
    expect(
      resized[1]!.geometry.top + resized[1]!.geometry.height,
    ).toBeLessThanOrEqual(600);
    expect(scope.placements[1]?.geometry).toEqual({
      left: 504,
      top: 0,
      width: 496,
      height: 800,
    });
  });

  test("native Single and insufficient stages leave App's active tab in place", () => {
    expect(
      spacesTabWindowEntries({
        scope: { ...scope, preset: "single" },
        tabs: tabs.slice(0, 2),
        activeTabId: "two",
        raisedIds: [],
        freeGeometry: {},
        stage,
        compact: false,
      }),
    ).toEqual([]);
    expect(
      spacesTabWindowEntries({
        scope,
        tabs: tabs.slice(0, 2),
        activeTabId: "two",
        raisedIds: [],
        freeGeometry: {},
        stage: { width: 330, height: 800 },
        compact: false,
      }),
    ).toEqual([]);
  });
});
