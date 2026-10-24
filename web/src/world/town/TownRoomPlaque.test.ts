import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Pane, Tab, Workspace } from "../../types";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { officeReadModel } from "../officeReadModel";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject, type WorldAgentStatus } from "../worldObject";
import type { TownRoomActions } from "./TownCanvas";
import { townModelFromProjection } from "./townModel";
import { TownRoomPlaque } from "./TownRoomPlaque";

function roomWith(statuses: readonly WorldAgentStatus[]) {
  // Several agent-report panes share one desk, with two plain terminals too.
  const panes: Pane[] = [...statuses, null, null].map((status, index) => ({
    pane_id: `p${index}`,
    terminal_id: `term${index}`,
    workspace_id: "room",
    tab_id: "desk",
    focused: index === 0,
    agent: status === null ? "" : "claude",
    agent_status: status ?? "",
    revision: 1,
  }));
  const workspace: Workspace = {
    workspace_id: "room",
    label: "Studio",
    number: 1,
    focused: true,
    tab_count: 1,
    pane_count: panes.length,
    active_tab_id: "desk",
    agent_status: "",
  };
  const tab: Tab = {
    workspace_id: "room",
    tab_id: "desk",
    label: "Desk",
    number: 1,
    focused: true,
    pane_count: panes.length,
    agent_status: "",
  };
  const connection: WorldRuntimeConnection = {
    connectionId: "host",
    label: "Host",
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs: [tab], panes, agents: [] },
  };
  return projectWorldOffice(buildWorldObject([connection], "host"), 1);
}

const actions = {
  canRenameRoom: () => true,
  onRenameRoom() {},
  canCloseRoom: () => true,
  onCloseRoom() {},
} as unknown as TownRoomActions;

test.each([
  [
    [
      "working",
      "working",
      "blocked",
      "idle",
      "idle",
      "done",
      "done",
      "unknown",
    ],
    "3/8",
  ],
  [["idle", "idle"], "0/2"],
  [[], "0/0"],
  [["working", "blocked", "working"], "3/3"],
  [["done", "idle", "unknown"], "0/3"],
] as const)(
  "room plaque sums the board's per-agent status counts: %j -> %s",
  async (statuses, expected) => {
    const office = roomWith(statuses);
    const room = office.rooms[0]!;
    const counts = townModelFromProjection(office).roomCounts.get(room.key)!;
    // These are the same prepared semantic contributions consumed by Town Summary/board.
    const board = officeReadModel(office).roomCounts.get(room.key) ?? {
      working: 0,
      blocked: 0,
      done: 0,
      idle: 0,
      unknown: 0,
    };
    const active = board.working + board.blocked;
    const total = Object.values(board).reduce((sum, count) => sum + count, 0);
    expect(counts.agents).toBe(statuses.length);
    expect(counts.agents).toBe(total);
    expect(counts.desks).toBe(1);
    const description = `${active} of ${total} agents active: ${board.working} working, ${board.blocked} waiting on you`;
    const browser = new Window();
    try {
      browser.document.body.innerHTML = renderToStaticMarkup(
        createElement(TownRoomPlaque, {
          room,
          label: "Studio",
          width: 176,
          counts,
          overflow: 0,
          color: null,
          actions,
        }),
      );
      const count = browser.document.querySelector(".town-room-plaque-count")!;
      expect(count.textContent).toBe(expected);
      expect(count.textContent).toBe(`${active}/${total}`);
      expect(count.getAttribute("title")).toBe(description);
      expect(count.getAttribute("aria-label")).toBe(description);
      expect(
        browser.document
          .querySelector(".town-room-plaque")!
          .getAttribute("aria-label"),
      ).toBe(`Studio: ${description}`);
      expect(count.classList.contains("is-inactive")).toBe(active === 0);
      expect(count.querySelector(".town-room-plaque-total")!.textContent).toBe(
        `/${total}`,
      );
    } finally {
      await browser.happyDOM.close();
    }
  },
);
