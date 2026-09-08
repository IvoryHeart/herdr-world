import { describe, expect, it } from "vitest";
import { hostProfile } from "../hostProfile";
import type { AgentStatus, PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "../types";
import {
  OFFICE_PRESENTATION_BOUNDS,
  projectHerdrOffice as projectOfficeModel,
} from "./herdrOfficeProjection";
import { buildWorldModel } from "./worldModel";
import type { WorldRuntimeSource } from "./worldModel";

function projectHerdrOffice(sources: readonly WorldRuntimeSource[], generatedAt: number) {
  return projectOfficeModel(buildWorldModel(sources), generatedAt);
}

describe("Herdr Office projection", () => {
  it("uses structured status for truthful destinations despite misleading labels", () => {
    const workspaces = [workspace("workspace-a", 1, "Alpha")];
    const tabs = ["working", "idle", "blocked", "done", "unknown", "shell"].map(
      (id, index) => tab(`tab-${id}`, "workspace-a", index + 1, id),
    );
    const source = liveHost("profile-a", 0, snapshot(
      workspaces,
      [
        pane("terminal-working", "pane-working", "workspace-a", "tab-working", "working", {
          display_agent: "Codex",
          task_summary: "Reviewing the office persistence changes",
          state_labels: { working: "Reviewing", idle: "Pretend idle" },
        }),
        pane("terminal-idle", "pane-idle", "workspace-a", "tab-idle", "idle", {
          agent: "claude",
          state_labels: { working: "This must not move the agent" },
        }),
        pane("terminal-blocked", "pane-blocked", "workspace-a", "tab-blocked", "blocked", {
          agent: "pi",
        }),
        pane("terminal-done", "pane-done", "workspace-a", "tab-done", "done", {
          agent: "grok",
        }),
        pane("terminal-unknown", "pane-unknown", "workspace-a", "tab-unknown", "unknown", {
          title: "Agent process",
        }),
        pane("terminal-shell", "pane-shell", "workspace-a", "tab-shell", "unknown"),
      ],
      tabs,
    ));

    const projection = projectHerdrOffice([source], 42);

    expect(projection.generatedAt).toBe(42);
    expect(projection.coverage.observedAgents).toBe(5);
    expect(projection.coverage.observedDesks).toBe(6);
    expect(projection.coverage.status).toEqual({
      working: 1,
      idle: 1,
      blocked: 1,
      done: 1,
      unknown: 1,
    });
    expect(projection.rooms[0].roomAgents.map(({ semanticStatus }) => semanticStatus))
      .toEqual(["working", "unknown"]);
    expect(projection.roster.find(({ agent }) => agent.displayLabel === "Codex")?.agent.taskSummary)
      .toBe("Reviewing the office persistence changes");
    expect(projection.receptions[0].waitingAgents.map(({ semanticStatus }) => semanticStatus))
      .toEqual(["blocked"]);
    expect(projection.barAgents.map(({ semanticStatus }) => semanticStatus))
      .toEqual(["idle", "done"]);
    const completedAgent = projection.roster.find(({ agent }) => agent.semanticStatus === "done")?.agent;
    const completedDesk = projection.deskRoster.find(({ desk }) =>
      completedAgent ? desk.completionAgentKeys.includes(completedAgent.key) : false,
    )?.desk;
    expect(completedAgent).toBeDefined();
    expect(completedDesk?.completionAgentKeys).toEqual([completedAgent?.key]);
    expect(projection.deskRoster.some(({ desk }) =>
      desk.completionAgentKeys.some((key) =>
        projection.roster.find(({ agent }) => agent.key === key)?.agent.semanticStatus === "blocked",
      ),
    )).toBe(false);
    expect(projection.roster.find(({ agent }) => agent.displayLabel === "claude")?.agent)
      .toMatchObject({
        destination: "bar",
        semanticStatus: "idle",
        stateLabels: { working: "This must not move the agent" },
      });
    expect(projection.roster.find(({ agent }) => agent.semanticStatus === "unknown")?.agent.displayLabel)
      .toBe("Agent");
  });

  it("projects one qualified deterministic desk per admitted tab including empty colliding labels", () => {
    const workspaces = [workspace("workspace-a", 1, "Alpha")];
    const tabs = Array.from({ length: 6 }, (_, index) =>
      tab(`tab-${index}`, "workspace-a", 6 - index, index < 2 ? "Same" : `Tab ${index}`),
    );
    const projection = projectHerdrOffice([
      liveHost("profile-a", 0, snapshot(workspaces, [], tabs)),
    ], 1);

    expect(projection.rooms[0].desks).toHaveLength(6);
    expect(projection.rooms[0].desks.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(projection.rooms[0].desks.map(({ key }) => key)).size).toBe(6);
    expect(projection.rooms[0].desks.every(({ occupantAgentKey }) => !occupantAgentKey)).toBe(true);
    expect(projection.deskRoster).toHaveLength(6);
    expect(projection.roster).toHaveLength(0);
  });

  it("seats working before focused unknown and stands remaining or out-of-bound desk agents", () => {
    const workspaces = [workspace("workspace-a", 1, "Alpha")];
    const tabs = Array.from({ length: 9 }, (_, index) =>
      tab(`tab-${index}`, "workspace-a", index + 1, `Tab ${index + 1}`),
    );
    const projection = projectHerdrOffice([
      liveHost("profile-a", 0, snapshot(
        workspaces,
        [
          pane("terminal-unknown", "pane-unknown", "workspace-a", "tab-0", "unknown", {
            agent: "unknown",
            focused: true,
          }),
          pane("terminal-working", "pane-working", "workspace-a", "tab-0", "working", {
            agent: "working",
          }),
          pane("terminal-outside", "pane-outside", "workspace-a", "tab-8", "working", {
            agent: "outside",
          }),
        ],
        tabs,
      )),
    ], 1);

    const room = projection.rooms[0];
    const working = room.roomAgents.find(({ displayLabel }) => displayLabel === "working");
    const unknown = room.roomAgents.find(({ displayLabel }) => displayLabel === "unknown");
    const outside = room.roomAgents.find(({ displayLabel }) => displayLabel === "outside");
    expect(room.desks).toHaveLength(8);
    expect(room.desks[0].occupantAgentKey).toBe(working?.key);
    expect(working?.placement).toBe("seated");
    expect(unknown?.placement).toBe("standing");
    expect(outside).toMatchObject({ placement: "standing", destination: "room" });
    expect(room.omittedDeskCount).toBe(1);
    expect(projection.roster.find(({ agent }) => agent.key === outside?.key)?.deskPresented)
      .toBe(false);
  });

  it("keeps colliding hosts, tabs, rooms, and agents distinct at qualified reception desks", () => {
    const sources = ["profile-a", "profile-b"].map((profileId, index) =>
      liveHost(profileId, index, snapshot(
        [workspace("same-workspace", 1, "main")],
        [pane("same-terminal", "same-pane", "same-workspace", "same-tab", "blocked", {
          display_agent: "Same agent",
        })],
        [tab("same-tab", "same-workspace", 1, "Same tab")],
      ), "Duplicate host"),
    );

    const projection = projectHerdrOffice(sources, 1);

    expect(new Set(projection.hosts.map(({ key }) => key)).size).toBe(2);
    expect(new Set(projection.rooms.map(({ key }) => key)).size).toBe(2);
    expect(new Set(projection.deskRoster.map(({ desk }) => desk.key)).size).toBe(2);
    expect(new Set(projection.roster.map(({ agent }) => agent.key)).size).toBe(2);
    expect(projection.receptions).toHaveLength(2);
    expect(projection.receptions.map(({ waitingAgents }) => waitingAgents[0].hostKey))
      .toEqual(["profile-a", "profile-b"]);
  });

  it("keeps stable terminal identity and character choice while current pane navigation moves", () => {
    const project = (paneId: string) => projectHerdrOffice([
      liveHost("profile-a", 0, snapshot(
        [workspace("workspace-a", 1, "Alpha")],
        [pane("terminal-stable", paneId, "workspace-a", "tab-a", "working", { agent: "codex" })],
        [tab("tab-a", "workspace-a", 1, "Tab")],
      )),
    ], 1).roster[0].agent;
    const first = project("pane-old");
    const moved = project("pane-new");

    expect(moved.key).toBe(first.key);
    expect(moved.characterIndex).toBe(first.characterIndex);
    expect(moved.currentPaneRef.nativeTargetId).toBe("pane-new");
    expect(moved.currentPaneRef.nativeTargetId).not.toBe(first.currentPaneRef.nativeTargetId);
  });

  it("marks retained hosts, desks, rooms, and agents stale without changing destinations", () => {
    const source = liveHost("profile-a", 0, snapshot(
      [workspace("workspace-a", 1, "Alpha")],
      [pane("terminal-a", "pane-a", "workspace-a", "tab-a", "working", { agent: "codex" })],
      [tab("tab-a", "workspace-a", 1, "Tab")],
    ));
    source.connectionState = "offline";

    const projection = projectHerdrOffice([source], 1);

    expect(projection.hosts[0]).toMatchObject({ stale: true, connectionState: "offline" });
    expect(projection.rooms[0]).toMatchObject({ stale: true, canOpenInSpaces: false });
    expect(projection.rooms[0].desks[0]).toMatchObject({ stale: true, canOpenInSpaces: false });
    expect(projection.roster[0].agent).toMatchObject({
      stale: true,
      canOpenInSpaces: false,
      semanticStatus: "working",
      destination: "room",
    });
  });

  it("enforces every presentation bound while retaining complete semantic rosters", () => {
    const sources = Array.from({ length: 7 }, (_, hostIndex) => {
      const workspaces = Array.from(
        { length: hostIndex === 0 ? 123 : 1 },
        (_, workspaceIndex) => workspace(
          `workspace-${hostIndex}-${workspaceIndex}`,
          workspaceIndex,
          `Workspace ${hostIndex}-${workspaceIndex}`,
        ),
      );
      const tabs = workspaces.map((entry) =>
        tab(`tab-${entry.workspace_id}`, entry.workspace_id, 1, "Tab"),
      );
      const panes: PaneInfo[] = [];
      if (hostIndex === 0) {
        for (let index = 0; index < 10; index += 1) {
          tabs.push(tab(`extra-tab-${index}`, "workspace-0-0", index + 2, `Extra ${index}`));
        }
        for (let index = 0; index < 18; index += 1) {
          panes.push(pane(
            `terminal-room-${index}`,
            `pane-room-${index}`,
            "workspace-0-0",
            index < 9 ? `extra-tab-${index}` : "tab-workspace-0-0",
            index % 3 === 0 ? "unknown" : "working",
            { agent: `room-${index}` },
          ));
        }
        for (let index = 0; index < 6; index += 1) {
          panes.push(pane(
            `terminal-blocked-${index}`,
            `pane-blocked-${index}`,
            "workspace-0-0",
            "tab-workspace-0-0",
            "blocked",
            { agent: `blocked-${index}` },
          ));
        }
        for (let index = 0; index < 20; index += 1) {
          panes.push(pane(
            `terminal-bar-${index}`,
            `pane-bar-${index}`,
            "workspace-0-0",
            "tab-workspace-0-0",
            index % 2 === 0 ? "idle" : "done",
            { agent: `bar-${index}` },
          ));
        }
      }
      return liveHost(`profile-${hostIndex}`, hostIndex, snapshot(workspaces, panes, tabs));
    });

    const projection = projectHerdrOffice(sources, 1);

    expect(projection.presentationBounds).toMatchObject({
      renderedRooms: OFFICE_PRESENTATION_BOUNDS.rooms,
      totalRooms: 129,
      renderedReceptionDesks: OFFICE_PRESENTATION_BOUNDS.receptionDesks,
      totalReceptionDesks: 7,
      renderedRoomAgents: OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
      totalRoomAgents: 18,
      renderedWaitingAgents: OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
      totalWaitingAgents: 6,
      renderedBarAgents: OFFICE_PRESENTATION_BOUNDS.barAgents,
      totalBarAgents: 20,
      rosterPage: 50,
    });
    expect(projection.rooms).toHaveLength(128);
    expect(projection.roomRoster).toHaveLength(129);
    expect(projection.rooms[0].desks).toHaveLength(8);
    expect(projection.rooms[0].roomAgents).toHaveLength(16);
    expect(projection.receptions[0].waitingAgents).toHaveLength(4);
    expect(projection.barAgents).toHaveLength(16);
    expect(projection.roster).toHaveLength(44);
    expect(projection.coverage).toMatchObject({
      omittedRooms: 1,
      omittedDesks: 4,
      omittedRoomAgents: 2,
      omittedReceptionDesks: 1,
      omittedWaitingAgents: 2,
      omittedBarAgents: 4,
    });
  });

  it("keeps empty workspaces visible and disabled hosts structural-only", () => {
    const disabled = liveHost("disabled", 0, snapshot(
      [workspace("hidden", 1, "Hidden")],
      [],
      [tab("hidden-tab", "hidden", 1, "Hidden tab")],
    ));
    disabled.profile = { ...disabled.profile, enabled: false };
    disabled.connectionState = "disabled";
    const live = liveHost("live", 1, snapshot(
      [workspace("empty", 1, "Empty workspace")],
      [],
      [tab("empty-tab", "empty", 1, "Shell")],
    ));

    const projection = projectHerdrOffice([disabled, live], 1);

    expect(projection.hosts).toHaveLength(2);
    expect(projection.rooms.map(({ displayLabel }) => displayLabel)).toEqual(["Empty workspace"]);
    expect(projection.rooms[0]).toMatchObject({ observedAgentCount: 0, observedDeskCount: 1 });
    expect(projection.rooms[0].desks[0].occupantAgentKey).toBeUndefined();
    expect(projection.receptions).toHaveLength(1);
    expect(projection.coverage.disabledHosts).toBe(1);
  });
});

function liveHost(
  profileId: string,
  displayOrder: number,
  value: Snapshot,
  label = `Host ${profileId}`,
): WorldRuntimeSource {
  return {
    profile: hostProfile(profileId, label, `http://${profileId}.example`, true, displayOrder),
    location: "remote",
    connectionState: "compatible",
    generationKey: `${profileId}:generation-1`,
    features: ["snapshot", "terminal_attach"],
    snapshot: value,
  };
}

function snapshot(
  workspaces: WorkspaceInfo[],
  panes: PaneInfo[],
  tabs: TabInfo[] = workspaces.map((entry) =>
    tab(`tab-${entry.workspace_id}`, entry.workspace_id, 1, "Tab", entry.focused)),
): Snapshot {
  return { workspaces, tabs, panes, layouts: [] };
}

function workspace(id: string, number: number, label: string): WorkspaceInfo {
  return {
    workspace_id: id,
    number,
    label,
    focused: number === 1,
    pane_count: 0,
    tab_count: 1,
    active_tab_id: `tab-${id}`,
    agent_status: "unknown",
  };
}

function tab(
  id: string,
  workspaceId: string,
  number: number,
  label: string,
  focused = false,
): TabInfo {
  return {
    tab_id: id,
    workspace_id: workspaceId,
    number,
    label,
    focused,
    pane_count: 0,
    agent_status: "unknown",
  };
}

function pane(
  terminalId: string,
  paneId: string,
  workspaceId: string,
  tabId: string,
  status: AgentStatus,
  overrides: Partial<PaneInfo> = {},
): PaneInfo {
  return {
    pane_id: paneId,
    terminal_id: terminalId,
    workspace_id: workspaceId,
    tab_id: tabId,
    focused: false,
    agent_status: status,
    revision: 1,
    ...overrides,
  };
}
