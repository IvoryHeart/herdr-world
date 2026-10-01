import { describe, expect, test } from "bun:test";

const it = test;
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { OfficeLayoutPublisher, resolveOfficeGeometry } from "./officeLayout";
import {
  officeStandingAgentAnchors,
  officeSemanticTargets,
  MIN_OFFICE_TOUCH_TARGET,
} from "./officeSemanticTargets";

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
      "agent-done",
      "room-a",
      "agent-seated",
      "desk-empty",
      "agent-standing",
    ]);
    expect(targets.find(({ key }) => key === "agent-seated")).toMatchObject({
      kind: "agent",
      canActivate: true,
      label:
        "Codex, Reviewing, desk Build, Platform, Forge, Running release checks",
    });
    expect(targets.find(({ key }) => key === "desk-empty")?.label).toBe(
      "Empty desk Review, Platform, Forge",
    );
    expect(targets.find(({ key }) => key === "desk-empty")?.canActivate).toBe(
      true,
    );
    expect(
      targets.every(
        ({ rect }) =>
          rect.width >= MIN_OFFICE_TOUCH_TARGET &&
          rect.height >= MIN_OFFICE_TOUCH_TARGET,
      ),
    ).toBe(true);
  });

  it("keeps pane devices, occupied desks and nearby agents distinct", () => {
    const projection = fixtureProjection();
    const room = projection.rooms[0]!;
    const desk = room.desks[0]!;
    desk.observedPaneCount = 5;
    desk.omittedPaneCount = 1;
    desk.paneDevices = [0, 1, 2, 3].map((order) => ({
      key: `pane-device-${order}`,
      nodeId: `pane-${order}`,
      deskKey: desk.key,
      hostKey: desk.hostKey,
      roomKey: room.key,
      displayLabel: `Shell ${order + 1}`,
      order,
      stale: false,
      canOpenInSpaces: true,
      paneRef: { nativeId: `pane-${order}` } as never,
      terminalRef: {} as never,
    }));
    const standing = room.roomAgents[1]!;
    standing.deskKey = desk.key;
    standing.currentPaneRef = { nativeId: "pane-1" } as never;
    const companions = [2, 3, 4].map((index) => ({
      ...standing,
      key: `agent-standing-${index}`,
      currentPaneRef: { nativeId: `pane-${index}` } as never,
    }));
    room.roomAgents.push(...companions);
    const geometry = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        {
          id: room.key,
          deskCount: 2,
          standingCount: 0,
          deskFootprintWidth: 176,
          deskFootprintHeight: 300,
        },
      ],
    });
    const layout = new OfficeLayoutPublisher().publish(
      { canonicalDigest: geometry.inputDigest },
      geometry,
    );
    const grouped = officeStandingAgentAnchors(room, layout.rooms[0]!);
    expect(grouped.map(({ agent }) => agent.key)).toEqual([
      standing.key,
      ...companions.map(({ key }) => key),
    ]);
    expect(grouped.every(({ anchor }) => "compact" in anchor)).toBe(true);
    const targets = officeSemanticTargets(projection, layout);
    expect(
      targets.filter(({ kind }) => kind === "pane").map(({ key }) => key),
    ).toEqual([
      "pane-device-0",
      "pane-device-1",
      "pane-device-2",
      "pane-device-3",
    ]);
    expect(targets.find(({ key }) => key === desk.key)?.kind).toBe("desk");
    expect(targets.find(({ key }) => key === "agent-seated")?.kind).toBe(
      "agent",
    );
    expect(targets.find(({ key }) => key === "pane-device-0")?.label).toContain(
      "5 panes",
    );
    const local = targets.filter(
      ({ key }) =>
        key === desk.key ||
        key === "agent-seated" ||
        key === standing.key ||
        companions.some((agent) => agent.key === key) ||
        key.startsWith("pane-device"),
    );
    expect(
      local.every(({ rect }) => rect.width >= 24 && rect.height >= 24),
    ).toBe(true);
    for (const left of local)
      for (const right of local) {
        if (left.key === right.key) continue;
        const a = left.rect,
          b = right.rect;
        expect(
          a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y,
        ).toBe(false);
      }
  });

  it("keeps eight agents at one reception separately selectable", () => {
    const projection = fixtureProjection();
    const agent = projection.barAgents[0]!;
    projection.barAgents = [];
    projection.receptions = [
      {
        key: "reception-a",
        hostKey: "host-a",
        hostLabel: "Forge",
        stale: false,
        waitingAgents: Array.from({ length: 8 }, (_, index) => ({
          ...agent,
          key: `waiting-${index}`,
        })),
        observedWaitingAgentCount: 8,
        overflowCount: 0,
      },
    ];
    const geometry = resolveOfficeGeometry({
      availableViewportWidth: 1120,
      titleMode: "expand",
      roomAlignment: "left",
      ceoReceptionCount: 1,
      rooms: [],
    });
    const layout = new OfficeLayoutPublisher().publish(
      { canonicalDigest: geometry.inputDigest },
      geometry,
    );
    const targets = officeSemanticTargets(projection, layout);
    expect(targets).toHaveLength(8);
    for (const [index, left] of targets.entries()) {
      expect(left.rect.width).toBeGreaterThanOrEqual(24);
      expect(left.rect.height).toBeGreaterThanOrEqual(24);
      for (const right of targets.slice(index + 1)) {
        const a = left.rect;
        const b = right.rect;
        expect(
          a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y,
        ).toBe(false);
      }
    }
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
    const done = {
      ...seated,
      key: "agent-done",
      deskKey: null,
      displayLabel: "Gemini",
      taskSummary: "Completed review",
      semanticStatus: "done",
      placement: "bar",
    };
    const buildDesk = {
      key: "desk-build",
      hostKey: "host-a",
      roomKey: "room-a",
      displayLabel: "Build",
      occupantAgentKey: seated.key,
      canOpenInSpaces: true,
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
      rooms: [
        {
          key: "room-a",
          hostKey: "host-a",
          displayLabel: "Platform",
          canOpenInSpaces: true,
          desks: [buildDesk, emptyDesk],
          roomAgents: [seated, standing],
        },
      ],
      receptions: [],
      barAgents: [done],
      roomRoster: [
        { key: "room-a", hostLabel: "Forge", displayLabel: "Platform" },
      ],
      deskRoster: [
        { desk: buildDesk, roomLabel: "Platform", hostLabel: "Forge" },
        { desk: emptyDesk, roomLabel: "Platform", hostLabel: "Forge" },
      ],
      roster: [
        { agent: seated, roomLabel: "Platform", hostLabel: "Forge" },
        { agent: standing, roomLabel: "Platform", hostLabel: "Forge" },
        { agent: done, roomLabel: "Platform", hostLabel: "Forge" },
      ],
      unresolved: [],
      coverage: {},
      presentationBounds: {},
    } as unknown as HerdrOfficeProjection;
  }
});
