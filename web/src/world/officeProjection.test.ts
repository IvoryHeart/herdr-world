import { describe, expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject } from "./worldObject";
import {
  OFFICE_PRESENTATION_BOUNDS,
  projectWorldOffice,
} from "./officeProjection";

describe("Pixel Office projection", () => {
  test("places agents by structured status and keeps every admitted tab as a desk", () => {
    const tabs = [
      tab("work", 1),
      tab("unknown", 2),
      tab("blocked", 3),
      tab("idle", 4),
      tab("done", 5),
      tab("shell", 6),
    ];
    const panes = [
      pane("work", "working", "Codex"),
      pane("unknown", "unknown", "Pi"),
      pane("blocked", "blocked", "Claude"),
      pane("idle", "idle", "Gemini"),
      pane("done", "done", "Grok"),
      { ...pane("shell", "unknown"), agent: undefined },
    ];
    const world = buildWorldObject([connection("local", tabs, panes)], "local");

    const office = projectWorldOffice(world, 42);

    expect(office.generatedAt).toBe(42);
    expect(office.coverage).toMatchObject({
      observedAgents: 5,
      observedDesks: 6,
      status: { working: 1, unknown: 1, blocked: 1, idle: 1, done: 1 },
    });
    expect(office.rooms[0].desks).toHaveLength(6);
    expect(
      office.rooms[0].roomAgents.map(({ semanticStatus }) => semanticStatus),
    ).toEqual(["working", "unknown"]);
    expect(
      office.receptions[0].waitingAgents.map(
        ({ semanticStatus }) => semanticStatus,
      ),
    ).toEqual(["blocked"]);
    expect(
      office.barAgents.map(({ semanticStatus }) => semanticStatus),
    ).toEqual(["idle", "done"]);
  });

  test("qualifies colliding native identifiers and disables inactive host operations", () => {
    const sources = ["host-a", "host-b"].map((id) =>
      connection(id, [tab("shared", 1)], [pane("shared", "working", id)]),
    );
    const office = projectWorldOffice(buildWorldObject(sources, "host-a"), 1);

    expect(new Set(office.hosts.map(({ key }) => key)).size).toBe(2);
    expect(new Set(office.rooms.map(({ key }) => key)).size).toBe(2);
    expect(new Set(office.deskRoster.map(({ desk }) => desk.key)).size).toBe(2);
    expect(new Set(office.roster.map(({ agent }) => agent.key)).size).toBe(2);
    expect(office.hosts.map(({ connectionState }) => connectionState)).toEqual([
      "active",
      "ready-inactive",
    ]);
    expect(office.rooms.map(({ canOpenInSpaces }) => canOpenInSpaces)).toEqual([
      true,
      false,
    ]);
  });

  test("seats only one bounded room agent per desk and reports exact omissions", () => {
    const tabs = Array.from({ length: 9 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const panes = Array.from({ length: 18 }, (_, index) =>
      pane(
        index === 17 ? "tab-8" : `tab-${index % 8}`,
        index % 2 ? "unknown" : "working",
        `agent-${index}`,
        index,
      ),
    );
    const office = projectWorldOffice(
      buildWorldObject([connection("local", tabs, panes)], "local"),
      1,
    );
    const room = office.rooms[0];

    expect(room.desks).toHaveLength(OFFICE_PRESENTATION_BOUNDS.desksPerRoom);
    expect(room.roomAgents).toHaveLength(
      OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
    );
    expect(
      room.roomAgents.filter(({ placement }) => placement === "seated"),
    ).toHaveLength(8);
    expect(room.omittedDeskCount).toBe(1);
    expect(room.omittedAgentCount).toBe(2);
    expect(office.coverage).toMatchObject({
      omittedDesks: 1,
      omittedRoomAgents: 2,
    });
    expect(office.roster).toHaveLength(18);
  });

  test("keeps mixed-status shared tabs truthful beyond the eight-desk scene bound", () => {
    const tabs = Array.from({ length: 9 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const working = pane("tab-0", "working", "working", 1);
    const unknown = {
      ...pane("tab-0", "unknown", "unknown", 2),
      focused: true,
    };
    const outside = pane("tab-8", "working", "outside", 3);
    const office = projectWorldOffice(
      buildWorldObject(
        [connection("local", tabs, [unknown, working, outside])],
        "local",
      ),
      1,
    );
    const room = office.rooms[0];
    const workingAgent = room.roomAgents.find(
      ({ displayLabel }) => displayLabel === "working",
    );
    const unknownAgent = room.roomAgents.find(
      ({ displayLabel }) => displayLabel === "unknown",
    );
    const outsideAgent = room.roomAgents.find(
      ({ displayLabel }) => displayLabel === "outside",
    );

    expect(room.desks[0].occupantAgentKey).toBe(workingAgent?.key);
    expect(workingAgent?.placement).toBe("seated");
    expect(unknownAgent?.placement).toBe("standing");
    expect(outsideAgent).toMatchObject({
      placement: "standing",
      destination: "room",
    });
    expect(
      office.roster.find(({ agent }) => agent.key === outsideAgent?.key),
    ).toMatchObject({ roomPresented: true, deskPresented: false });
  });

  test("retains stale topology without admitting Office operations", () => {
    const source = connection(
      "remote",
      [tab("tab", 1)],
      [pane("tab", "working", "Codex")],
    );
    source.state = "reconnecting";
    source.stale = true;
    source.actionable = false;
    const office = projectWorldOffice(buildWorldObject([source], "remote"), 1);

    expect(office.hosts[0]).toMatchObject({
      connectionState: "reconnecting",
      stale: true,
    });
    expect(office.rooms[0]).toMatchObject({
      stale: true,
      canOpenInSpaces: false,
    });
    expect(office.roster[0].agent).toMatchObject({
      stale: true,
      canOpenInSpaces: false,
      destination: "room",
    });
  });
});

function connection(
  id: string,
  tabs: Tab[],
  panes: Pane[],
): WorldRuntimeConnection {
  const workspace: Workspace = {
    workspace_id: "workspace",
    number: 1,
    label: "Alpha",
    focused: true,
    pane_count: panes.length,
    tab_count: tabs.length,
    active_tab_id: tabs[0]?.tab_id,
    agent_status: "working",
  };
  return {
    connectionId: id,
    label: id,
    source: "saved-profile",
    isDefault: id === "local",
    state: "ready",
    generation: 7,
    snapshotGeneration: 7,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs, panes, agents: [] },
  };
}

function tab(id: string, number: number): Tab {
  return {
    tab_id: id,
    workspace_id: "workspace",
    number,
    label: `Tab ${number}`,
    focused: number === 1,
    pane_count: 1,
    agent_status: "working",
  };
}

function pane(tabId: string, status: string, agent?: string, index = 0): Pane {
  return {
    pane_id: `pane-${tabId}-${index}`,
    terminal_id: `terminal-${tabId}-${index}`,
    workspace_id: "workspace",
    tab_id: tabId,
    focused: index === 0,
    agent,
    agent_status: status,
    revision: 1,
  };
}
