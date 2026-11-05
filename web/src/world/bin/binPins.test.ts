import { expect, test } from "bun:test";
import { binEmptiesPinnedTab, type BinEntry } from "../../../../shared/bin";
import type { BoardPane, BoardTab } from "../board/boardModel";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { binDropOfAgent } from "./binTown";
import { boardBinCandidate } from "./useBoardBin";

const PINNED = new Set(["w1:t1"]);

function boardTab(): BoardTab {
  const pane = (id: string): BoardPane =>
    ({
      key: `studio:${id}`,
      status: "idle",
      isAgent: true,
      leaf: {
        connectionId: "studio",
        generation: 4,
        workspaceId: "w1",
        tabId: "w1:t1",
        nativeId: id,
        terminalId: `term-${id}`,
        label: id,
        stale: false,
        actionable: true,
      },
    }) as unknown as BoardPane;
  return { key: "studio:w1:t1", panes: [pane("p1"), pane("p2")] } as BoardTab;
}

const staged = (pane: string): BinEntry => ({
  id: `bin-run-${pane}`,
  connection_id: "studio",
  connection_generation: 4,
  workspace_id: "w1",
  tab_id: "w1:t1",
  pane_id: pane,
  terminal_id: `term-${pane}`,
  label: pane,
  view: "board",
  duration_ms: 30_000,
  departure_ms: 6_000,
  remaining_ms: 36_000,
  trip: pane,
});

test("Board: a pinned tab keeps its last pane when its sibling already waits in the bin", () => {
  const tab = boardTab();
  const [p1, p2] = tab.panes;
  // Either pane alone may go: the tab keeps the other.
  expect(
    boardBinCandidate(tab, p1, "board", [], PINNED)!.drag.refusal,
  ).toBeNull();
  // With p1 already staged, p2 is the pinned tab's last pane.
  const waiting = [staged("p1")];
  expect(
    boardBinCandidate(tab, p2, "board", waiting, PINNED)!.drag.refusal,
  ).toContain("pinned tab");
  // An unpinned tab may lose both.
  expect(
    boardBinCandidate(tab, p2, "board", waiting, new Set())!.drag.refusal,
  ).toBeNull();
  // A sibling staged under an older generation is not this pane's sibling.
  expect(
    boardBinCandidate(
      tab,
      p2,
      "board",
      [{ ...staged("p1"), connection_generation: 3 }],
      PINNED,
    )!.drag.refusal,
  ).toBeNull();
});

/** A room with one tab of `panes`, of which the desk lists at most four. */
function office(panes = ["p1", "p2"]): HerdrOfficeProjection {
  const ref = (kind: string, nativeId: string) => ({
    connectionId: "studio",
    generation: 4,
    kind,
    nativeId,
    worldId: `${kind}:${nativeId}`,
  });
  const agent = (pane: string) => ({
    key: `agent-${pane}`,
    roomKey: "room-1",
    deskKey: "desk-1",
    stale: false,
    displayLabel: pane,
    currentPaneRef: ref("pane", pane),
    currentTabRef: ref("tab", "w1:t1"),
    currentTerminalRef: ref("terminal", `term-${pane}`),
  });
  return {
    roster: panes.map((pane) => ({ agent: agent(pane) })),
    rooms: [
      {
        key: "room-1",
        workspaceRef: ref("workspace", "w1"),
        desks: [
          {
            key: "desk-1",
            paneDevices: panes.slice(0, 4).map((pane) => ({
              paneRef: ref("pane", pane),
              terminalRef: ref("terminal", `term-${pane}`),
            })),
            omittedPaneCount: Math.max(0, panes.length - 4),
          },
        ],
      },
    ],
  } as unknown as HerdrOfficeProjection;
}

test("Town: the same rule holds for agents sent to the bus stop", () => {
  const town = office();
  expect(
    "refusal" in binDropOfAgent(town, "agent-p2", "town", [], PINNED),
  ).toBe(false);
  const refused = binDropOfAgent(
    town,
    "agent-p2",
    "town",
    [staged("p1")],
    PINNED,
  );
  expect("refusal" in refused && refused.refusal).toContain("pinned tab");
  // A staged pane from another runtime generation is a different pane.
  const other = { ...staged("p1"), connection_generation: 3 };
  expect(
    "refusal" in binDropOfAgent(town, "agent-p2", "town", [other], PINNED),
  ).toBe(false);
});

test("Town: a desk that lists only some of a pinned tab's panes leaves the rule to the service", () => {
  // Six panes, the desk lists four: Town cannot see p5 and p6, so it must
  // not refuse p4 (or p5) as the last pane; the service reads every pane.
  const panes = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const town = office(panes);
  for (const [agentKey, waiting] of [
    ["agent-p4", ["p1", "p2", "p3"]],
    ["agent-p5", ["p1", "p2", "p3", "p4"]],
  ] as const) {
    const drop = binDropOfAgent(
      town,
      agentKey,
      "town",
      waiting.map(staged),
      PINNED,
    );
    expect("refusal" in drop).toBe(false);
    // It goes in asking the service to keep the pinned tab's last pane.
    expect(drop).toMatchObject({ preserve_tab: true });
  }
  // The service's rule over all six panes agrees: p5 and p6 survive p4.
  const all = panes.map((pane) => ({
    pane_id: pane,
    terminal_id: `term-${pane}`,
  }));
  expect(
    binEmptiesPinnedTab(
      { connection_id: "studio", connection_generation: 4, pane_id: "p4" },
      all,
      ["p1", "p2", "p3"].map(staged),
    ),
  ).toBe(false);
});
