import { describe, expect, it, vi } from "vitest";

import type { BridgeRuntime } from "../bridge";
import type { BridgeConnectionState } from "../runtimeConnection";
import type { Snapshot } from "../types";
import type { HerdrOfficeProjection, OfficeRoom } from "./herdrOfficeProjection";
import { createWorldRoomActions } from "./worldRoomActions";

describe("World room actions", () => {
  it("routes a new seat to the room's qualified host and workspace", () => {
    const hostA = runtime("host-a", ["snapshot", "launcher_presets"], ["tab.create"]);
    const hostB = runtime("host-b", ["snapshot", "launcher_presets"], ["tab.create"]);
    const callbacks = callbackSpies();
    const actions = createWorldRoomActions({
      ...options([hostA, hostB], [room("room-b", "host-b", "workspace-b")], callbacks),
      selectedRuntimeId: "host-a",
      selectedWorkspaceId: "workspace-a",
    });

    expect(actions.canCreateSeat("room-b")).toBe(true);
    actions.openNewSeat("room-b");

    expect(callbacks.onSelectWorkspace).toHaveBeenCalledWith("host-b", "workspace-b");
    expect(callbacks.onOpenSeatLauncher).toHaveBeenCalledWith({
      bridgeId: "host-b",
      workspaceId: "workspace-b",
    });
    expect(callbacks.onStatus).not.toHaveBeenCalled();
  });

  it("fails closed when a host omits one required capability or command", () => {
    const host = runtime("host-a", ["snapshot"], ["workspace.rename"]);
    const callbacks = callbackSpies();
    const actions = createWorldRoomActions(
      options([host], [room("room-a", "host-a", "workspace-a")], callbacks),
    );

    expect(actions.canCreateSeat("room-a")).toBe(false);
    expect(actions.canCreateRoom("room-a")).toBe(false);
    expect(actions.canRenameRoom("room-a")).toBe(true);
    expect(actions.canCloseRoom("room-a")).toBe(false);

    actions.openNewSeat("room-a");
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(
      "New seats are unavailable on this host.",
    );
    expect(callbacks.onOpenSeatLauncher).not.toHaveBeenCalled();
  });

  it("emits bounded semantic dialog requests for room operations", () => {
    const host = runtime(
      "host-a",
      ["snapshot"],
      ["workspace.create", "workspace.rename", "workspace.close"],
    );
    const callbacks = callbackSpies();
    const actions = createWorldRoomActions(
      options([host], [room("room-a", "host-a", "workspace-a", "Studio")], callbacks),
    );

    actions.openNewRoom("room-a");
    actions.openRoomRename("room-a");
    actions.openRoomClose("room-a");

    expect(callbacks.onOpenRoomDialog.mock.calls).toEqual([
      [{ mode: "create", bridgeId: "host-a", workspaceId: "new", label: "" }],
      [{
        mode: "rename",
        bridgeId: "host-a",
        workspaceId: "workspace-a",
        label: "Studio",
      }],
      [{
        mode: "close",
        bridgeId: "host-a",
        workspaceId: "workspace-a",
        label: "Studio",
      }],
    ]);
    expect(callbacks.onSelectBridge).toHaveBeenCalledOnce();
    expect(callbacks.onSelectBridge).toHaveBeenCalledWith("host-a");
  });
});

function options(
  runtimes: readonly BridgeRuntime[],
  rooms: readonly OfficeRoom[],
  callbacks: ReturnType<typeof callbackSpies>,
) {
  const states = Object.fromEntries(
    runtimes.map((candidate) => [candidate.id, admittedState(candidate)]),
  );
  return {
    projection: { rooms } as HerdrOfficeProjection,
    getRuntime: (bridgeId: string | null | undefined) =>
      runtimes.find(({ id }) => id === bridgeId) ?? null,
    connectionStates: states,
    selectedRuntimeId: runtimes[0]?.id ?? null,
    selectedWorkspaceId: "selected-workspace",
    createTabSupported: true,
    requiredCapabilities: ["snapshot"],
    ...callbacks,
  };
}

function callbackSpies() {
  return {
    onStatus: vi.fn<(message: string) => void>(),
    onSelectBridge: vi.fn<(bridgeId: string) => void>(),
    onSelectWorkspace: vi.fn<(bridgeId: string, workspaceId: string) => void>(),
    onOpenSeatLauncher: vi.fn(),
    onOpenRoomDialog: vi.fn(),
  };
}

function runtime(
  id: string,
  features: string[],
  commands: string[],
): BridgeRuntime {
  return {
    id,
    mode: "configured",
    label: id,
    color: "#89b4fa",
    backend: null,
    connectionKey: `${id}:connection`,
    capabilityGeneration: 1,
    generationKey: `${id}:connection:1`,
    resumeToken: 0,
    capabilities: {
      features,
      commands,
      launcher_presets: { version: 1 },
    },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => `http://${id}.test${path}`,
    wsUrl: (path) => `ws://${id}.test${path}`,
  };
}

function admittedState(candidate: BridgeRuntime): BridgeConnectionState {
  return {
    connectionKey: candidate.generationKey,
    snapshot: {} as Snapshot,
    loadState: "ready",
  };
}

function room(
  key: string,
  hostKey: string,
  workspaceId: string,
  displayLabel = key,
): OfficeRoom {
  return {
    key,
    hostKey,
    workspaceRef: {
      profileId: hostKey,
      kind: "workspace",
      nativeTargetId: workspaceId,
    },
    observedGeneration: `${hostKey}:connection:1`,
    displayLabel,
    order: 0,
    stale: false,
    canOpenInSpaces: true,
    desks: [],
    roomAgents: [],
    omittedDeskCount: 0,
    omittedAgentCount: 0,
    observedDeskCount: 0,
    observedAgentCount: 0,
  };
}
