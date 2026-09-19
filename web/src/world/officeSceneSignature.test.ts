import { describe, expect, test } from "bun:test";

const it = test;
import { OFFICE_PRESENTATION_BOUNDS } from "./herdrOfficeProjection";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { resolveOfficeLayout } from "./officeGeometry";
import { officeSceneSignature } from "./officeSceneSignature";

function projection(
  generatedAt: number,
  working: number,
): HerdrOfficeProjection {
  return {
    version: 1,
    generatedAt,
    hosts: [],
    rooms: [],
    receptions: [],
    barAgents: [],
    roomRoster: [],
    deskRoster: [],
    roster: [],
    unresolved: [],
    coverage: {
      configuredHosts: 0,
      observedHosts: 0,
      compatibleHosts: 0,
      connectingHosts: 0,
      staleHosts: 0,
      observedWorkspaces: 0,
      observedDesks: 0,
      observedAgents: working,
      status: { working, idle: 0, blocked: 0, done: 0, unknown: 0 },
      omittedRooms: 0,
      omittedDesks: 0,
      omittedRoomAgents: 0,
      omittedReceptionDesks: 0,
      omittedWaitingAgents: 0,
      omittedBarAgents: 0,
    },
    presentationBounds: {
      ...OFFICE_PRESENTATION_BOUNDS,
      totalRooms: 0,
      renderedRooms: 0,
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

describe("officeSceneSignature", () => {
  const layout = resolveOfficeLayout(1120, []);

  it("ignores projection timestamps", () => {
    const first = officeSceneSignature({
      layout,
      projection: projection(1, 2),
      selectedKey: null,
      visibleRoomIndices: [],
    });
    const second = officeSceneSignature({
      layout,
      projection: projection(2, 2),
      selectedKey: null,
      visibleRoomIndices: [],
    });

    expect(second).toBe(first);
  });

  it("changes when rendered coverage changes", () => {
    const first = officeSceneSignature({
      layout,
      projection: projection(1, 1),
      selectedKey: null,
      visibleRoomIndices: [],
    });
    const second = officeSceneSignature({
      layout,
      projection: projection(1, 2),
      selectedKey: null,
      visibleRoomIndices: [],
    });

    expect(second).not.toBe(first);
  });

  it("changes when completion markers become seen", () => {
    const first = officeSceneSignature({
      layout,
      projection: projection(1, 1),
      selectedKey: null,
      completionSeenKeys: new Set(),
      visibleRoomIndices: [],
    });
    const second = officeSceneSignature({
      layout,
      projection: projection(1, 1),
      selectedKey: null,
      completionSeenKeys: new Set(["terminal-done"]),
      visibleRoomIndices: [],
    });

    expect(second).not.toBe(first);
  });
});
