import { describe, expect, it } from "vitest";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { OfficeLayoutPublisher, resolveOfficeGeometry } from "./officeLayout";
import { officeSemanticTargets, MIN_OFFICE_TOUCH_TARGET } from "./officeSemanticTargets";

describe("Office semantic targets", () => {
  it("publishes exact room and station identities with touch-sized rectangles", () => {
    const projection = fixtureProjection();
    const geometry = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [{ id: "room-a", deskCount: 2, standingCount: 1 }],
    });
    const layout = new OfficeLayoutPublisher().publish(
      { canonicalDigest: geometry.inputDigest },
      geometry,
    );

    const targets = officeSemanticTargets(projection, layout);

    expect(targets.map(({ key }) => key)).toEqual([
      "room-a",
      "agent-seated",
      "desk-empty",
      "agent-standing",
    ]);
    expect(targets.find(({ key }) => key === "agent-seated")).toMatchObject({
      kind: "agent",
      canActivate: true,
      label: "Codex, Reviewing, desk Build, Platform, Forge, Running release checks",
    });
    expect(targets.find(({ key }) => key === "desk-empty")?.label)
      .toBe("Empty desk Review, Platform, Forge");
    expect(targets.every(({ rect }) =>
      rect.width >= MIN_OFFICE_TOUCH_TARGET && rect.height >= MIN_OFFICE_TOUCH_TARGET,
    )).toBe(true);
  });

  function fixtureProjection() {
    const seated = {
      key: "agent-seated",
      hostKey: "host-a",
      roomKey: "room-a",
      deskKey: "desk-build",
      displayLabel: "Codex",
      taskSummary: "Running release checks",
      semanticStatus: "working",
      stateLabels: { working: "Reviewing" },
      placement: "seated",
      stale: false,
      canOpenInSpaces: true,
    };
    const standing = {
      ...seated,
      key: "agent-standing",
      deskKey: null,
      displayLabel: "Claude",
      taskSummary: undefined,
      placement: "standing",
    };
    const buildDesk = {
      key: "desk-build",
      hostKey: "host-a",
      roomKey: "room-a",
      displayLabel: "Build",
      occupantAgentKey: seated.key,
    };
    const emptyDesk = {
      ...buildDesk,
      key: "desk-empty",
      displayLabel: "Review",
      occupantAgentKey: undefined,
    };
    return {
      version: 1,
      generatedAt: 1,
      hosts: [{ key: "host-a", displayLabel: "Forge" }],
      rooms: [{
        key: "room-a",
        hostKey: "host-a",
        displayLabel: "Platform",
        canOpenInSpaces: true,
        desks: [buildDesk, emptyDesk],
        roomAgents: [seated, standing],
      }],
      receptions: [],
      barAgents: [],
      roomRoster: [{ key: "room-a", hostLabel: "Forge", displayLabel: "Platform" }],
      deskRoster: [
        { desk: buildDesk, roomLabel: "Platform", hostLabel: "Forge" },
        { desk: emptyDesk, roomLabel: "Platform", hostLabel: "Forge" },
      ],
      roster: [
        { agent: seated, roomLabel: "Platform", hostLabel: "Forge" },
        { agent: standing, roomLabel: "Platform", hostLabel: "Forge" },
      ],
      unresolved: [],
      coverage: {},
      presentationBounds: {},
    } as unknown as HerdrOfficeProjection;
  }
});
