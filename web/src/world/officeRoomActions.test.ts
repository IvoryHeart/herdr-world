import { describe, expect, test } from "bun:test";
import type { OfficeRoom } from "./herdrOfficeProjection";
import {
  CREATED_PANE_ADMISSION_TIMEOUT_MS,
  createdPaneAdmissionRetryDelay,
  createdRootPaneId,
  officeCreationActionState,
  officeRoomActionCapabilities,
  officeRoomKeyForSelection,
} from "./officeRoomActions";
import type { WorldObject, WorldSpaceObject } from "./worldObject";

describe("Office room actions", () => {
  test("admits mutations only for the active room's exact host and workspace", () => {
    const active = space("active", "workspace-a", true, true);
    const inactive = space("inactive", "workspace-b", false, true);
    const world = worldWith(active, inactive);

    expect(
      officeRoomActionCapabilities(world, room("active", "workspace-a")),
    ).toEqual({ createSeat: true, rename: true, close: true });
    expect(
      officeRoomActionCapabilities(world, room("inactive", "workspace-b")),
    ).toEqual({ createSeat: false, rename: false, close: false });
  });

  test("fails closed for a missing or stale workspace", () => {
    const world = worldWith(space("active", "workspace-a", true, false));
    expect(
      officeRoomActionCapabilities(world, room("active", "workspace-a")),
    ).toEqual({ createSeat: false, rename: false, close: false });
    expect(
      officeRoomActionCapabilities(world, room("active", "missing")),
    ).toEqual({ createSeat: false, rename: false, close: false });
  });

  test("resolves an agent or terminal selection back to its room", () => {
    const active = space("active", "workspace-a", true, true);
    const world = worldWith(active);
    expect(officeRoomKeyForSelection(world, active.id)).toBe(active.id);
    expect(officeRoomKeyForSelection(world, active.children[0]!.id)).toBe(
      active.id,
    );
    expect(officeRoomKeyForSelection(world, "missing")).toBeNull();
  });

  test("accepts only the authoritative root pane from a create response", () => {
    expect(createdRootPaneId({ root_pane: { pane_id: "pane-new" } })).toBe(
      "pane-new",
    );
    expect(createdRootPaneId({ pane: { pane_id: "pane-other" } })).toBeNull();
    expect(createdRootPaneId({ root_pane: { pane_id: "" } })).toBeNull();
  });

  test("keeps retrying created-pane admission for a full World snapshot window", () => {
    const deadline = CREATED_PANE_ADMISSION_TIMEOUT_MS;
    expect(createdPaneAdmissionRetryDelay(deadline, 3_600)).toBe(120);
    expect(createdPaneAdmissionRetryDelay(deadline, 20_000)).toBe(120);
    expect(createdPaneAdmissionRetryDelay(deadline, deadline - 50)).toBe(50);
    expect(createdPaneAdmissionRetryDelay(deadline, deadline)).toBeNull();
  });

  test("keeps an admitted creation affordance visible while endpoint admission is transient", () => {
    expect(
      officeCreationActionState(true, "Endpoint metadata is loading"),
    ).toEqual({
      visible: true,
      enabled: false,
      reason: "Endpoint metadata is loading",
    });
    expect(officeCreationActionState(true, null)).toEqual({
      visible: true,
      enabled: true,
      reason: null,
    });
    expect(officeCreationActionState(false, null)).toEqual({
      visible: false,
      enabled: false,
      reason: null,
    });
  });
});

function room(connectionId: string, workspaceId: string): OfficeRoom {
  return {
    key: JSON.stringify([connectionId, "space", workspaceId]),
    hostKey: JSON.stringify([connectionId, "host", connectionId]),
    workspaceRef: {
      connectionId,
      generation: 1,
      kind: "workspace",
      nativeId: workspaceId,
      worldId: JSON.stringify([connectionId, "space", workspaceId]),
    },
    observedGeneration: 1,
    displayLabel: workspaceId,
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

function space(
  connectionId: string,
  workspaceId: string,
  selectedHost: boolean,
  actionable: boolean,
): WorldSpaceObject {
  const id = JSON.stringify([connectionId, "space", workspaceId]);
  return {
    id,
    kind: "space",
    nativeId: workspaceId,
    parentId: JSON.stringify([connectionId, "host", connectionId]),
    connectionId,
    generation: 1,
    label: workspaceId,
    hostLabel: connectionId,
    hostState: selectedHost ? "active" : "ready-inactive",
    selectedHost,
    stale: !actionable,
    actionable,
    capabilities: {
      activateHost: false,
      openTerminal: false,
      openSpaces: actionable,
      files: actionable,
      changes: actionable,
      agentHistory: false,
      roomMutation: actionable,
      launcher: actionable,
    },
    workspace: {
      workspace_id: workspaceId,
      number: 1,
      label: workspaceId,
      focused: true,
      pane_count: 1,
      tab_count: 1,
      agent_status: "idle",
    },
    tabs: [],
    children: [
      {
        id: JSON.stringify([connectionId, "terminal", "terminal-a"]),
        kind: "terminal",
        nativeId: "pane-a",
        parentId: id,
        connectionId,
        generation: 1,
        label: "Terminal",
        hostLabel: connectionId,
        hostState: selectedHost ? "active" : "ready-inactive",
        selectedHost,
        stale: !actionable,
        actionable,
        capabilities: {
          activateHost: false,
          openTerminal: actionable,
          openSpaces: actionable,
          files: actionable,
          changes: actionable,
          agentHistory: false,
          roomMutation: false,
          launcher: false,
        },
        pane: {
          pane_id: "pane-a",
          terminal_id: "terminal-a",
          workspace_id: workspaceId,
          tab_id: "tab-a",
          focused: true,
          agent_status: "idle",
          revision: 1,
        },
        workspaceId,
        tabId: "tab-a",
        terminalId: "terminal-a",
        status: "idle",
        focused: true,
        stateLabels: {},
        spaceLabel: workspaceId,
      },
    ],
    coverage: {
      spaces: 1,
      tabs: 0,
      leaves: 1,
      agents: 0,
      shells: 1,
      status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
    },
  };
}

function worldWith(...spaces: WorldSpaceObject[]): WorldObject {
  const nodes = [...spaces, ...spaces.flatMap((space) => space.children)];
  return {
    version: 1,
    hosts: [],
    spaces,
    leaves: spaces.flatMap((space) => space.children),
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage: spaces.reduce(
      (total, space) => ({
        spaces: total.spaces + space.coverage.spaces,
        tabs: total.tabs + space.coverage.tabs,
        leaves: total.leaves + space.coverage.leaves,
        agents: total.agents + space.coverage.agents,
        shells: total.shells + space.coverage.shells,
        status: {
          working: total.status.working + space.coverage.status.working,
          idle: total.status.idle + space.coverage.status.idle,
          blocked: total.status.blocked + space.coverage.status.blocked,
          done: total.status.done + space.coverage.status.done,
          unknown: total.status.unknown + space.coverage.status.unknown,
        },
      }),
      {
        spaces: 0,
        tabs: 0,
        leaves: 0,
        agents: 0,
        shells: 0,
        status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
      },
    ),
  };
}
