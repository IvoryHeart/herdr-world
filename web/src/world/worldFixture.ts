import { hostProfile } from "../hostProfile";
import type { AgentStatus, PaneInfo, Snapshot, WorkspaceInfo } from "../types";
import { projectHerdrOffice } from "./herdrOfficeProjection";
import { buildWorldModel } from "./worldModel";
import type { WorldRuntimeSource } from "./worldModel";

export const WORLD_VISUAL_FIXTURE_TIME = Date.UTC(2026, 7, 2, 12, 0, 0);

export const worldVisualFixture = projectHerdrOffice(
  buildWorldModel([
    fixtureHost({
      profileId: "fixture-host-atlas",
      label: "Forge",
      displayOrder: 0,
      workspaces: [
        fixtureWorkspace("platform", 1, "Platform"),
        fixtureWorkspace("release", 2, "Release Engineering"),
        fixtureWorkspace("research", 3, "Research Lab"),
      ],
      panes: [
        fixturePane("platform", "atlas-codex", "Codex", "working", "Implementing frame"),
        fixturePane("platform", "atlas-claude", "Claude", "blocked", "Needs input"),
        fixturePane("platform", "atlas-pi", "Pi", "idle", "Waiting"),
        fixturePane("platform", "atlas-grok", "Grok", "unknown", "Connecting"),
        fixturePane("platform", "atlas-open", "OpenCode", "working", "Reviewing tests"),
        fixturePane("platform", "atlas-six", "Agent", "idle", "Available"),
        fixturePane("release", "atlas-release", "Codex", "done", "Ready for review"),
        fixturePane("release", "atlas-release-2", "Claude", "working", "Packaging"),
        fixturePane("research", "atlas-research", "Pi", "idle", "Reading"),
      ],
    }),
    fixtureHost({
      profileId: "fixture-host-borealis",
      label: "Forge",
      displayOrder: 1,
      connectionState: "offline",
      workspaces: [
        fixtureWorkspace("main", 1, "Main"),
        fixtureWorkspace("sandbox", 2, "Sandbox"),
      ],
      panes: [
        fixturePane("main", "borealis-codex", "Codex", "working", "Last known working"),
        fixturePane("main", "borealis-claude", "Claude", "done", "Ready for review"),
      ],
    }),
    fixtureHost({
      profileId: "fixture-host-cinder",
      label: "Cinder",
      displayOrder: 2,
      features: ["snapshot"],
      workspaces: [fixtureWorkspace("ops", 1, "Operations")],
      panes: [
        fixturePane("ops", "cinder-codex", "Codex", "blocked", "Approval required"),
        fixturePane("ops", "cinder-pi", "Pi", "done", "Ready for review"),
      ],
    }),
  ]),
  WORLD_VISUAL_FIXTURE_TIME,
);

function fixtureHost({
  profileId,
  label,
  displayOrder,
  connectionState = "compatible",
  features = ["snapshot", "terminal_attach"],
  workspaces,
  panes,
}: {
  profileId: string;
  label: string;
  displayOrder: number;
  connectionState?: WorldRuntimeSource["connectionState"];
  features?: readonly string[];
  workspaces: WorkspaceInfo[];
  panes: PaneInfo[];
}): WorldRuntimeSource {
  return {
    profile: hostProfile(
      profileId,
      label,
      `http://${profileId}.fixture.invalid`,
      true,
      displayOrder,
    ),
    location: "remote",
    connectionState,
    generationKey: `${profileId}:fixture-generation`,
    features,
    snapshot: fixtureSnapshot(workspaces, panes),
  };
}
function fixtureSnapshot(workspaces: WorkspaceInfo[], panes: PaneInfo[]): Snapshot {
  const tabs = workspaces.map((workspace) => ({
    tab_id: `tab-${workspace.workspace_id}`,
    workspace_id: workspace.workspace_id,
    number: 1,
    label: "Agents",
    focused: workspace.focused,
    pane_count: panes.filter((pane) => pane.workspace_id === workspace.workspace_id).length,
    agent_status: "unknown" as const,
  }));
  return { workspaces, tabs, panes, layouts: [], selected_pane_id: panes[0]?.pane_id };
}

function fixtureWorkspace(id: string, number: number, label: string): WorkspaceInfo {
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

function fixturePane(
  workspaceId: string,
  id: string,
  displayAgent: string,
  status: AgentStatus,
  stateLabel: string,
): PaneInfo {
  return {
    pane_id: `pane-${id}`,
    terminal_id: `terminal-${id}`,
    workspace_id: workspaceId,
    tab_id: `tab-${workspaceId}`,
    focused: false,
    display_agent: displayAgent,
    agent: displayAgent.toLowerCase(),
    agent_status: status,
    state_labels: { [status]: stateLabel },
    revision: 1,
  };
}
