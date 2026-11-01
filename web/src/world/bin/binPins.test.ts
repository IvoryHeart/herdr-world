import { expect, test } from "bun:test";
import type { BinEntry } from "../../../../shared/bin";
import type { BoardPane, BoardTab } from "../board/boardModel";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { binDropOfAgent } from "./binTown";
import { binPaneKey, boardBinCandidate, stagedPaneKeys } from "./useBoardBin";

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
  remaining_ms: 30_000,
  trip: pane,
});

test("Board: a pinned tab keeps its last pane when its sibling already waits in the bin", () => {
  const tab = boardTab();
  const [p1, p2] = tab.panes;
  // Either pane alone may go: the tab keeps the other.
  expect(
    boardBinCandidate(tab, p1, "board", new Set(), PINNED)!.drag.refusal,
  ).toBeNull();
  // With p1 already staged, p2 is the pinned tab's last pane.
  const waiting = stagedPaneKeys([staged("p1")]);
  expect(waiting.has(binPaneKey("studio", 4, "p1"))).toBe(true);
  expect(
    boardBinCandidate(tab, p2, "board", waiting, PINNED)!.drag.refusal,
  ).toContain("pinned tab");
  // An unpinned tab may lose both.
  expect(
    boardBinCandidate(tab, p2, "board", waiting, new Set())!.drag.refusal,
  ).toBeNull();
});

function office(): HerdrOfficeProjection {
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
    roster: [{ agent: agent("p1") }, { agent: agent("p2") }],
    rooms: [
      {
        key: "room-1",
        workspaceRef: ref("workspace", "w1"),
        desks: [
          {
            key: "desk-1",
            paneDevices: ["p1", "p2"].map((pane) => ({
              paneRef: ref("pane", pane),
            })),
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
