import { describe, expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { mostUrgentStatus, projectBoard } from "./boardModel";

describe("Board model", () => {
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
