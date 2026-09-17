import { describe, expect, test } from "bun:test";

const it = test;
import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "./herdrOfficeProjection";
import {
  findOfficeSelection,
  formatOfficeActivityAge,
  officeCalloutForKey,
  officeSeatAvailability,
} from "./officeSelection";

function projection(): HerdrOfficeProjection {
  return {
    version: 1,
    generatedAt: 1,
    hosts: [
      {
        key: "host-a",
        displayLabel: "Office A",
        displayOrder: 0,
        connectionState: "active",
        observed: true,
        stale: false,
        compatibleWithWorld: true,
        compatibleWithSpaces: true,
        selected: true,
        deterministicSkin: { themeIndex: 0, badge: "HOST 01" },
      },
    ],
    rooms: [],
    receptions: [],
    barAgents: [],
    roomRoster: [
      {
        key: "host-a:workspace:room-a",
        hostKey: "host-a",
        hostLabel: "Office A",
        workspaceRef: {
          connectionId: "host-a",
          generation: 1,
          kind: "workspace",
          nativeId: "room-a",
          worldId: "host-a:workspace:room-a",
        },
        observedGeneration: 1,
        displayLabel: "Room A",
        order: 1,
        stale: false,
        canOpenInSpaces: true,
        presented: true,
      },
    ],
    deskRoster: [],
    roster: [],
    unresolved: [],
    coverage: {
      configuredHosts: 1,
      observedHosts: 1,
      compatibleHosts: 1,
      connectingHosts: 0,
      staleHosts: 0,
      observedWorkspaces: 1,
      observedDesks: 0,
      observedAgents: 0,
      status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
      omittedRooms: 0,
      omittedDesks: 0,
      omittedRoomAgents: 0,
      omittedReceptionDesks: 0,
      omittedWaitingAgents: 0,
      omittedBarAgents: 0,
    },
    presentationBounds: {
      rooms: 128,
      desksPerRoom: 8,
      roomAgentsPerRoom: 16,
      receptionDesks: 6,
      waitingAgentsPerReception: 4,
      barAgents: 16,
      rosterPage: 50,
      totalRooms: 1,
      renderedRooms: 1,
      totalDesks: 0,
      renderedDesks: 0,
      totalRoomAgents: 0,
      renderedRoomAgents: 0,
      totalReceptionDesks: 0,
      renderedReceptionDesks: 0,
      totalWaitingAgents: 0,
      renderedWaitingAgents: 0,
      totalBarAgents: 0,
      renderedBarAgents: 0,
    },
  };
}

describe("Office selection", () => {
  it("resolves the authoritative room, host, and empty states", () => {
    const current = projection();

    expect(findOfficeSelection(current, "host-a")).toMatchObject({
      kind: "host",
      host: { displayLabel: "Office A" },
    });
    expect(
      findOfficeSelection(current, "host-a:workspace:room-a"),
    ).toMatchObject({
      kind: "room",
      room: { displayLabel: "Room A" },
    });
    expect(findOfficeSelection(current, null)).toBeNull();
    expect(findOfficeSelection(current, "missing")).toBeNull();
  });

  it("formats bounded activity ages without inventing unavailable history", () => {
    expect(formatOfficeActivityAge(undefined, 100_000)).toBeNull();
    expect(formatOfficeActivityAge(99_500, 100_000)).toBe("just now");
    expect(formatOfficeActivityAge(40_000, 100_000)).toBe("1m ago");
    expect(formatOfficeActivityAge(3_000, 100_000)).toBe("1m ago");
    expect(formatOfficeActivityAge(-86_400_000, 100_000)).toBe("1d ago");
  });

  it("gates new seats on an admitted host, workspace, and tab capability", () => {
    expect(officeSeatAvailability(false, true, true)).toEqual({
      supported: false,
      reason: "host",
    });
    expect(officeSeatAvailability(true, false, true)).toEqual({
      supported: false,
      reason: "workspace",
    });
    expect(officeSeatAvailability(true, true, false)).toEqual({
      supported: false,
      reason: "capability",
    });
    expect(officeSeatAvailability(true, true, true)).toEqual({
      supported: true,
      reason: null,
    });
  });

  it("resolves bounded hover callouts from authoritative projection data", () => {
    const current = projection();

    expect(officeCalloutForKey(current, "host-a")).toEqual({
      kind: "host",
      title: "Office A",
      detail: "active · live Office state",
      status: null,
    });
    expect(officeCalloutForKey(current, "host-a:workspace:room-a")).toEqual({
      kind: "room",
      title: "Room A",
      detail: "0 desks · 0 agents · Office A",
      status: null,
    });
    expect(officeCalloutForKey(current, "missing")).toBeNull();
  });

  it("surfaces an available task summary in the selected agent callout", () => {
    const current = projection();
    const agent = {
      key: "agent-a",
      nodeId: "agent-a",
      currentPaneRef: {
        connectionId: "host-a",
        generation: 1,
        kind: "pane",
        nativeId: "pane-a",
        worldId: "agent-a",
      },
      currentTerminalRef: {
        connectionId: "host-a",
        generation: 1,
        kind: "terminal",
        nativeId: "terminal-a",
        worldId: "agent-a",
      },
      currentTabRef: {
        connectionId: "host-a",
        generation: 1,
        kind: "tab",
        nativeId: "tab-a",
        worldId: "agent-a",
      },
      deskKey: null,
      observedGeneration: 1,
      roomKey: "host-a:workspace:room-a",
      hostKey: "host-a",
      displayLabel: "Codex",
      taskSummary: "Reviewing the Office layout",
      semanticStatus: "working",
      stateLabels: { working: "Running" },
      focused: true,
      destination: "room",
      placement: "standing",
      stale: false,
      canOpenInSpaces: true,
      characterIndex: 0,
    } satisfies OfficeAgent;
    current.roster = [
      {
        agent,
        roomKey: "host-a:workspace:room-a",
        roomLabel: "Room A",
        hostKey: "host-a",
        hostLabel: "Office A",
        roomPresented: true,
        deskPresented: false,
        destinationPresented: true,
      },
    ];

    expect(officeCalloutForKey(current, "agent-a")).toMatchObject({
      title: "Codex",
      summary: "Reviewing the Office layout",
      status: "working",
    });
  });
});
