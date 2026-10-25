import { describe, expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import {
  mostUrgentStatus,
  prepareWorldBoard,
  projectBoard,
} from "./boardModel";
import { worldObjectWithWatches } from "../worldObject";
import { anchorFor, targetOf } from "./boardAnchors";

describe("Board model", () => {
  test("a prepared host is projected once, and unwatched hosts are reused", async () => {
    const world = fixtureWorld([
      fixtureHost("alpha", [
        { label: "web", tabs: [{ label: "build", panes: [["working"]] }] },
      ]),
      fixtureHost("beta", [
        { label: "web", tabs: [{ label: "build", panes: [["idle"]] }] },
      ]),
    ]);
    let yields = 0;
    await prepareWorldBoard(
      world,
      () => true,
      async () => {
        yields++;
      },
    );
    expect(yields).toBeGreaterThanOrEqual(0);
    const first = projectBoard(world);
    // A watch overlay with no watches is the same World; a watch on one
    // host copies only that host.
    expect(worldObjectWithWatches(world, [])).toBe(world);
    const beta = world.hosts[1]!;
    const leaf = beta.spaces[0]!.children[0]!;
    const watched = worldObjectWithWatches(world, [
      {
        connectionId: leaf.connectionId,
        generation: leaf.generation,
        terminalId: leaf.terminalId,
      },
    ]);
    expect(watched.hosts[0]).toBe(world.hosts[0]);
    expect(watched.hosts[1]).not.toBe(beta);
    const second = projectBoard(watched);
    expect(second.hosts[0]).toBe(first.hosts[0]);
    expect(second.hosts[1]).not.toBe(first.hosts[1]);
    expect(second.tabs[1]!.panes[0]!.leaf.watched).toBe(true);
  });

  test("hosts, workspaces and tabs keep Herdr's order and qualified keys", () => {
    const board = projectBoard(
      fixtureWorld([
        fixtureHost("alpha", [
          {
            label: "web",
            tabs: [
              { label: "build", panes: [["working"]] },
              { label: "shell", panes: [["idle", false]] },
            ],
          },
          { label: "docs", tabs: [{ label: "tutorial", panes: [["done"]] }] },
        ]),
        fixtureHost("beta", [
          { label: "web", tabs: [{ label: "build", panes: [["blocked"]] }] },
        ]),
      ]),
    );
    expect(board.hosts.map((host) => host.key)).toEqual(["alpha", "beta"]);
    expect(board.workspaces.map((space) => space.key)).toEqual([
      "alpha:w1",
      "alpha:w2",
      "beta:w1",
    ]);
    // Same native IDs on two hosts never collide.
    expect(board.tabs.map((tab) => tab.key)).toEqual([
      "alpha:w1:t1",
      "alpha:w1:t2",
      "alpha:w2:t1",
      "beta:w1:t1",
    ]);
    expect(board.tabByKey.get("alpha:w1:t2")?.panes[0]?.isAgent).toBe(false);
  });

  test("a tab takes its most urgent pane's status, and workspaces list statuses by urgency", () => {
    const board = projectBoard(
      fixtureWorld([
        fixtureHost("alpha", [
          {
            label: "web",
            tabs: [
              { label: "pair", panes: [["working"], ["blocked"]] },
              { label: "done", panes: [["done"]] },
              { label: "quiet", panes: [["idle"]] },
            ],
          },
        ]),
      ]),
    );
    expect(board.tabByKey.get("alpha:w1:t1")?.status).toBe("blocked");
    expect(board.workspaceByKey.get("alpha:w1")?.statuses).toEqual([
      "blocked",
      "done",
      "working",
      "idle",
    ]);
    expect(mostUrgentStatus(["idle", "unknown", "done"])).toBe("unknown");
  });

  test("a tab with the same ID as its workspace (older Herdr) gets its own card key", () => {
    const host = fixtureHost("beta", [
      {
        label: "shared",
        tabs: [{ label: "Synthetic tab", panes: [["idle"]] }],
      },
    ]);
    // Older Herdr: workspace, tab and pane can all be called "shared".
    const space = host.spaces[0]!;
    const legacy = {
      ...host,
      spaces: [
        {
          ...space,
          nativeId: "shared",
          tabs: space.tabs.map((tab) => ({ ...tab, tab_id: "shared" })),
          children: space.children.map((leaf) => ({
            ...leaf,
            workspaceId: "shared",
            tabId: "shared",
          })),
        },
      ],
    };
    const board = projectBoard(fixtureWorld([legacy]));
    const workspaceKey = board.workspaces[0]!.key;
    const tabKey = board.tabs[0]!.key;
    expect(tabKey).not.toBe(workspaceKey);
    expect(board.workspaceByKey.has(tabKey)).toBe(false);
    // A string to that tab still finds its card.
    const anchor = anchorFor(board, tabKey)!;
    expect(anchor).toMatchObject({ kind: "tab", native_id: "shared" });
    expect(targetOf(board, anchor)?.cardKey).toBe(tabKey);
  });

  test("every admitted tab is a card, even with no admitted pane", () => {
    const host = fixtureHost("alpha", [
      { label: "web", tabs: [{ label: "empty", panes: [] }] },
    ]);
    const board = projectBoard(fixtureWorld([host]));
    expect(board.tabs).toHaveLength(1);
    expect(board.tabs[0]).toMatchObject({
      label: "empty",
      status: "idle",
      panes: [],
    });
  });

  test("a stale host's cards are stale and not actionable", () => {
    const board = projectBoard(
      fixtureWorld([
        fixtureHost(
          "alpha",
          [{ label: "web", tabs: [{ label: "build", panes: [["working"]] }] }],
          { stale: true },
        ),
      ]),
    );
    expect(board.hosts[0]?.stale).toBe(true);
    expect(board.workspaces[0]).toMatchObject({
      stale: true,
      actionable: false,
    });
    expect(board.tabs[0]).toMatchObject({ stale: true, actionable: false });
  });
  test("shells never colour a tab, and overview squares put agents before shells", () => {
    const board = projectBoard(
      fixtureWorld([
        fixtureHost("alpha", [
          {
            label: "web",
            tabs: [
              { label: "pair", panes: [["unknown", false], ["working"]] },
              { label: "terminal", panes: [["unknown", false]] },
            ],
          },
        ]),
      ]),
    );
    expect(board.tabByKey.get("alpha:w1:t1")).toMatchObject({
      status: "working",
      shellOnly: false,
    });
    expect(board.tabByKey.get("alpha:w1:t2")).toMatchObject({
      status: "idle",
      shellOnly: true,
    });
    expect(board.workspaceByKey.get("alpha:w1")?.squares).toEqual([
      { status: "working", isAgent: true },
      { status: "unknown", isAgent: false },
      { status: "unknown", isAgent: false },
    ]);
  });
});

test("failed cached Board panes keep history without live status or action admission", () => {
  const board = projectBoard(
    fixtureWorld([
      fixtureHost(
        "failed",
        [{ label: "Room", tabs: [{ label: "Agent", panes: [["working"]] }] }],
        { stale: true },
      ),
      fixtureHost("healthy", [
        { label: "Room", tabs: [{ label: "Agent", panes: [["working"]] }] },
      ]),
    ]),
  );
  expect(board.hosts[0]!.stale).toBe(true);
  expect(board.tabs[0]!.actionable).toBe(false);
  expect(board.tabs[0]!.status).toBe("unknown");
  expect(board.tabs[0]!.panes[0]!.status).toBe("unknown");
  expect(board.tabs[0]!.panes[0]!.leaf.status).toBe("working");
  expect(board.tabs[1]!.actionable).toBe(true);
  expect(board.tabs[1]!.status).toBe("working");
});
