import { describe, expect, it } from "vitest";
import type { BridgeRuntime } from "../bridge";
import type { BridgeConnectionState } from "../runtimeConnection";
import { qualifyRuntimeTarget } from "../runtimeIdentity";
import type { PaneInfo, Snapshot } from "../types";
import type { OfficeAgent } from "./herdrOfficeProjection";
import {
  officeAgentHandoffRequest,
  officeRoomHandoffRequest,
  resolveOfficeHandoff,
} from "./herdrOfficeHandoff";
import type { OfficeHandoffRequest } from "./herdrOfficeHandoff";

describe("Herdr Office exact Spaces handoff", () => {
  it("builds the double-click shortcut request from qualified terminal identity", () => {
    const agent: OfficeAgent = {
      key: "host-a:terminal:stable-terminal",
      currentPaneRef: qualifyRuntimeTarget("host-a", "pane", "pane-a"),
      currentTerminalRef: qualifyRuntimeTarget("host-a", "terminal", "stable-terminal"),
      currentTabRef: qualifyRuntimeTarget("host-a", "tab", "tab-a"),
      deskKey: "host-a:tab:tab-a",
      observedGeneration: "host-a:connection:capability:1",
      roomKey: "host-a:workspace:workspace-a",
      hostKey: "host-a",
      displayLabel: "Codex",
      semanticStatus: "working",
      stateLabels: {},
      focused: true,
      destination: "room",
      placement: "seated",
      stale: false,
      canOpenInSpaces: true,
      characterIndex: 0,
    };

    expect(officeAgentHandoffRequest(agent)).toEqual({
      kind: "agent",
      key: agent.key,
      profileId: "host-a",
      observedGeneration: agent.observedGeneration,
      terminalRef: agent.currentTerminalRef,
      currentPaneRef: agent.currentPaneRef,
    });
  });

  it("builds the room double-click shortcut from qualified workspace identity", () => {
    const workspaceRef = qualifyRuntimeTarget("host-a", "workspace", "workspace-a");
    expect(officeRoomHandoffRequest({
      key: "host-a:workspace:workspace-a",
      hostKey: "host-a",
      hostLabel: "Host A",
      workspaceRef,
      observedGeneration: "generation-a",
      displayLabel: "Space A",
      order: 1,
      stale: false,
      canOpenInSpaces: true,
      presented: true,
    })).toEqual({
      kind: "room",
      key: "host-a:workspace:workspace-a",
      profileId: "host-a",
      observedGeneration: "generation-a",
      workspaceRef,
    });
  });

  it("re-resolves stable terminal identity to its current pane", () => {
    const runtime = liveRuntime();
    const request = agentRequest(runtime.generationKey, "old-pane");
    const currentPane = pane("new-pane", "stable-terminal");

    const result = resolveOfficeHandoff(request, runtime, admitted(runtime, currentPane));

    expect(result).toMatchObject({
      ok: true,
      kind: "agent",
      pane: { pane_id: "new-pane", terminal_id: "stable-terminal" },
    });
  });

  it("rejects a rendered target after a generation change", () => {
    const runtime = liveRuntime();
    const result = resolveOfficeHandoff(
      agentRequest("prior-generation", "old-pane"),
      runtime,
      admitted(runtime, pane("new-pane", "stable-terminal")),
    );

    expect(result).toMatchObject({ ok: false, reason: "reconnected" });
  });

  it("rejects stale, snapshot-only, and disappeared targets without guessing", () => {
    const runtime = liveRuntime();
    const request = agentRequest(runtime.generationKey, "pane-a");
    const stale = admitted(runtime, pane("pane-a", "stable-terminal"));
    stale.loadState = "error";
    expect(resolveOfficeHandoff(request, runtime, stale)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });

    const snapshotOnly = {
      ...runtime,
      capabilities: { ...runtime.capabilities!, features: ["snapshot"] },
    };
    expect(resolveOfficeHandoff(request, snapshotOnly, admitted(snapshotOnly))).toMatchObject({
      ok: false,
      reason: "unavailable",
    });

    expect(resolveOfficeHandoff(request, runtime, admitted(runtime))).toMatchObject({
      ok: false,
      reason: "missing",
    });
  });

  it("resolves an exact qualified workspace", () => {
    const runtime = liveRuntime();
    const request: OfficeHandoffRequest = {
      kind: "room",
      key: "room-key",
      profileId: runtime.id,
      observedGeneration: runtime.generationKey,
      workspaceRef: qualifyRuntimeTarget(runtime.id, "workspace", "workspace-a"),
    };

    expect(resolveOfficeHandoff(request, runtime, admitted(runtime))).toMatchObject({
      ok: true,
      kind: "room",
      workspace: { workspace_id: "workspace-a" },
    });
  });
});

function agentRequest(generation: string, paneId: string): OfficeHandoffRequest {
  return {
    kind: "agent",
    key: "agent-key",
    profileId: "host-a",
    observedGeneration: generation,
    terminalRef: qualifyRuntimeTarget("host-a", "terminal", "stable-terminal"),
    currentPaneRef: qualifyRuntimeTarget("host-a", "pane", paneId),
  };
}

function liveRuntime(): BridgeRuntime {
  return {
    id: "host-a",
    mode: "configured",
    label: "Host",
    color: "#fff",
    backend: null,
    connectionKey: "connection-a",
    capabilityGeneration: 1,
    generationKey: "connection-a:capability:1",
    resumeToken: 0,
    capabilities: {
      bridge_api_version: 1,
      bridge_version: "0.1.0",
      herdr_version: "0.9.0",
      terminal_protocol: 22,
      features: ["snapshot", "terminal_attach"],
      commands: [],
    },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => path,
    wsUrl: (path) => path,
  };
}

function admitted(runtime: BridgeRuntime, ...panes: PaneInfo[]): BridgeConnectionState {
  const snapshot: Snapshot = {
    workspaces: [
      {
        workspace_id: "workspace-a",
        number: 1,
        label: "Workspace",
        focused: true,
        pane_count: panes.length,
        tab_count: 1,
        active_tab_id: "tab-a",
        agent_status: "working",
      },
    ],
    tabs: [],
    panes,
    layouts: [],
  };
  return { connectionKey: runtime.generationKey, snapshot, loadState: "ready" };
}

function pane(paneId: string, terminalId: string): PaneInfo {
  return {
    pane_id: paneId,
    terminal_id: terminalId,
    workspace_id: "workspace-a",
    tab_id: "tab-a",
    focused: true,
    agent: "codex",
    display_agent: "Codex",
    agent_status: "working",
    revision: 1,
  };
}
