import { describe, expect, test } from "bun:test";
import {
  queueVisibleTabLayoutRead,
  shareVisibleTabLayoutRead,
  tabLayoutMatchesSnapshot,
} from "./visibleTabLayout";
import type { Pane, PaneLayout, Tab, Workspace } from "./types";

const identity = {
  connectionId: "connection-example",
  connectionGeneration: 4,
  runtimeGeneration: 8,
  workspaceId: "workspace-example",
  tabId: "tab-example",
};

function pane(paneId: string, tabId = identity.tabId): Pane {
  return {
    pane_id: paneId,
    terminal_id: `terminal-${paneId}`,
    workspace_id: identity.workspaceId,
    tab_id: tabId,
    focused: paneId === "pane-a",
    agent_status: "unknown",
    revision: 1,
  };
}

const workspace: Workspace = {
  workspace_id: identity.workspaceId,
  number: 1,
  label: "Workspace",
  focused: true,
  pane_count: 2,
  tab_count: 1,
  agent_status: "unknown",
};

const tab: Tab = {
  tab_id: identity.tabId,
  workspace_id: identity.workspaceId,
  number: 1,
  label: "Tab",
  focused: true,
  pane_count: 2,
  agent_status: "unknown",
};

const layout: PaneLayout = {
  workspace_id: identity.workspaceId,
  tab_id: identity.tabId,
  zoomed: false,
  area: { x: 0, y: 0, width: 100, height: 40 },
  focused_pane_id: "pane-a",
  panes: [
    {
      pane_id: "pane-a",
      focused: true,
      rect: { x: 0, y: 0, width: 50, height: 40 },
    },
    {
      pane_id: "pane-b",
      focused: false,
      rect: { x: 50, y: 0, width: 50, height: 40 },
    },
  ],
  splits: [],
};

const snapshot = {
  activeConnectionId: identity.connectionId,
  connectionGeneration: identity.connectionGeneration,
  serverRuntimeGeneration: identity.runtimeGeneration,
  workspaces: [workspace],
  tabs: [tab],
  panes: [pane("pane-a"), pane("pane-b")],
};

describe("visible tab layout fencing", () => {
  test("bounds concurrent reads and skips a tab retired while queued", async () => {
    const gates = Array.from({ length: 6 }, () =>
      Promise.withResolvers<number>(),
    );
    const started: number[] = [];
    let sixthNeeded = true;
    const reads = gates.map((gate, index) =>
      queueVisibleTabLayoutRead(
        () => {
          started.push(index);
          return gate.promise;
        },
        () => index !== 5 || sixthNeeded,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1, 2, 3]);
    sixthNeeded = false;
    gates[0]!.resolve(0);
    gates[1]!.resolve(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1, 2, 3, 4]);
    for (const index of [2, 3, 4]) gates[index]!.resolve(index);
    expect(await Promise.all(reads)).toEqual([
      { skipped: false, value: 0 },
      { skipped: false, value: 1 },
      { skipped: false, value: 2 },
      { skipped: false, value: 3 },
      { skipped: false, value: 4 },
      { skipped: true },
    ]);
  });

  test("a tab's terminal and title map share one read", async () => {
    const gate = Promise.withResolvers<string>();
    let reads = 0;
    const read = () => {
      reads += 1;
      return gate.promise;
    };
    // Other tabs fill the queue, so this tab's read waits its turn.
    const busy = Promise.withResolvers<void>();
    const others = Array.from({ length: 4 }, () =>
      queueVisibleTabLayoutRead(
        () => busy.promise,
        () => true,
      ),
    );
    let terminalNeeds = true;
    const terminal = shareVisibleTabLayoutRead(
      "tab",
      read,
      () => terminalNeeds,
    );
    const map = shareVisibleTabLayoutRead("tab", read, () => true);
    // The read still runs for the map after the terminal stops needing it.
    terminalNeeds = false;
    busy.resolve();
    await Promise.all(others);
    await new Promise((resolve) => setTimeout(resolve, 0));
    gate.resolve("layout");
    expect(await terminal).toEqual({ skipped: false, value: "layout" });
    expect(await map).toEqual({ skipped: false, value: "layout" });
    expect(reads).toBe(1);
    await shareVisibleTabLayoutRead("tab", read, () => true);
    expect(reads).toBe(2);
  });

  test("a queued read reads through a caller that still needs it", async () => {
    // Other tabs fill the queue, so this tab's read waits its turn.
    const busy = Promise.withResolvers<void>();
    const others = Array.from({ length: 4 }, () =>
      queueVisibleTabLayoutRead(
        () => busy.promise,
        () => true,
      ),
    );
    const asked: string[] = [];
    // The terminal asked through pane p1, which then closed.
    let p1Open = true;
    const first = shareVisibleTabLayoutRead(
      "closing-tab",
      async () => {
        asked.push("p1");
        return "pane not found";
      },
      () => p1Open,
    );
    p1Open = false;
    const second = shareVisibleTabLayoutRead(
      "closing-tab",
      async () => {
        asked.push("p2");
        return "layout";
      },
      () => true,
    );
    busy.resolve();
    await Promise.all(others);
    expect(await second).toEqual({ skipped: false, value: "layout" });
    expect(await first).toEqual({ skipped: false, value: "layout" });
    expect(asked).toEqual(["p2"]);
  });

  test("a read already sent is never shared with a later caller", async () => {
    const gate = Promise.withResolvers<string>();
    let reads = 0;
    const read = () => {
      reads += 1;
      return reads === 1 ? gate.promise : Promise.resolve("newer");
    };
    const sent = shareVisibleTabLayoutRead("busy-tab", read, () => true);
    // Let the first read start before the next observation asks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const later = shareVisibleTabLayoutRead("busy-tab", read, () => true);
    expect(await later).toEqual({ skipped: false, value: "newer" });
    gate.resolve("older");
    expect(await sent).toEqual({ skipped: false, value: "older" });
    expect(reads).toBe(2);
  });

  test("accepts exactly the current tab split", () => {
    expect(tabLayoutMatchesSnapshot(layout, identity, snapshot)).toBe(true);
  });

  test("rejects an old connection or runtime lease", () => {
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        connectionGeneration: 5,
      }),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        serverRuntimeGeneration: 9,
      }),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        activeConnectionId: "other",
      }),
    ).toBe(false);
  });

  test("rejects split, close and move races", () => {
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        panes: [...snapshot.panes, pane("pane-c")],
      }),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        panes: [pane("pane-a")],
      }),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        panes: [pane("pane-a"), pane("pane-b", "other-tab")],
      }),
    ).toBe(false);
  });

  test("rejects malformed layout replies before presenting terminals", () => {
    expect(
      tabLayoutMatchesSnapshot(
        { ...layout, panes: undefined },
        identity,
        snapshot,
      ),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(
        { ...layout, area: { x: 0 } },
        identity,
        snapshot,
      ),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(
        { ...layout, area: { ...layout.area, width: -1 } },
        identity,
        snapshot,
      ),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(
        { ...layout, area: { ...layout.area, height: 0 } },
        identity,
        snapshot,
      ),
    ).toBe(false);
  });

  test("accepts a tab no client shows, whose panes can be 0 cells tall", () => {
    const squeezed: PaneLayout = {
      ...layout,
      area: { x: 0, y: 0, width: 10, height: 1 },
      panes: [
        { ...layout.panes[0]!, rect: { x: 0, y: 0, width: 5, height: 1 } },
        { ...layout.panes[1]!, rect: { x: 5, y: 1, width: 5, height: 0 } },
      ],
    };
    expect(tabLayoutMatchesSnapshot(squeezed, identity, snapshot)).toBe(true);
    expect(
      tabLayoutMatchesSnapshot(
        {
          ...squeezed,
          panes: [
            squeezed.panes[0]!,
            {
              ...squeezed.panes[1]!,
              rect: { x: 5, y: 1, width: 5, height: -1 },
            },
          ],
        },
        identity,
        snapshot,
      ),
    ).toBe(false);
  });

  test("rejects a tab or workspace no longer in the observed topology", () => {
    expect(
      tabLayoutMatchesSnapshot(layout, identity, { ...snapshot, tabs: [] }),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        workspaces: [],
      }),
    ).toBe(false);
    expect(
      tabLayoutMatchesSnapshot(layout, identity, {
        ...snapshot,
        workspaces: [{ ...workspace, focused: false }],
      }),
    ).toBe(true);
  });
});
