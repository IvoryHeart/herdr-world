import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "./herdrOfficeProjection";
import {
  deskAnchor,
  OFFICE_GEOMETRY,
  receptionAgentAnchor,
  standingAnchor,
} from "./officeGeometry";
import type { OfficeRect } from "./officeGeometry";
import type { PublishedOfficeLayout } from "./officeLayout";

export const MIN_OFFICE_TOUCH_TARGET = 48;

export type OfficeSemanticTarget = {
  key: string;
  kind: "room" | "desk" | "agent";
  label: string;
  rect: OfficeRect;
  canActivate: boolean;
};

export function officeSemanticTargets(
  projection: HerdrOfficeProjection,
  layout: PublishedOfficeLayout,
): OfficeSemanticTarget[] {
  if (layout.fallbackMessage) {
    return [];
  }
  const targets: OfficeSemanticTarget[] = [];

  projection.receptions.forEach((reception, receptionIndex) => {
    const rect = layout.ceoBlocks.receptions.find(({ index }) => index === receptionIndex);
    if (!rect) {
      return;
    }
    reception.waitingAgents.forEach((agent, agentIndex) => {
      const anchor = receptionAgentAnchor(rect, agentIndex);
      targets.push(agentTarget(
        projection,
        agent,
        touchRect(anchor.x, anchor.nameY - 5, anchor.stationSpan - 4, anchor.characterFeetY - anchor.nameY + 10),
      ));
    });
  });

  projection.rooms.forEach((room, roomIndex) => {
    const rect = layout.rooms.find(({ index }) => index === roomIndex);
    if (!rect) {
      return;
    }
    const header = rect.header;
    const titleWidth = Math.max(
      MIN_OFFICE_TOUCH_TARGET,
      Math.min(
        rect.headerRect.width,
        header?.titleBoxWidth ?? rect.headerRect.width - OFFICE_GEOMETRY.roomHeaderChromeWidth,
      ),
    );
    targets.push({
      key: room.key,
      kind: "room",
      label: roomTargetLabel(projection, room),
      rect: touchRect(
        rect.headerRect.x + (header?.titleBoxX ?? (rect.headerRect.width - titleWidth) / 2) + titleWidth / 2,
        rect.headerRect.y - (MIN_OFFICE_TOUCH_TARGET - rect.headerRect.height) / 2,
        titleWidth,
        MIN_OFFICE_TOUCH_TARGET,
      ),
      canActivate: room.canOpenInSpaces,
    });

    room.desks.forEach((desk, deskIndex) => {
      const anchor = deskAnchor(rect, deskIndex);
      const occupant = desk.occupantAgentKey
        ? room.roomAgents.find(({ key }) => key === desk.occupantAgentKey)
        : undefined;
      const stationRect = touchRect(
        anchor.x,
        anchor.nameY - 5,
        anchor.stationSpan - 4,
        anchor.characterFeetY - anchor.nameY + OFFICE_GEOMETRY.deskHeight + 8,
      );
      targets.push(occupant
        ? agentTarget(projection, occupant, stationRect, desk)
        : {
            key: desk.key,
            kind: "desk",
            label: deskTargetLabel(projection, desk),
            rect: stationRect,
            canActivate: false,
          });
    });

    room.roomAgents
      .filter(({ placement }) => placement === "standing")
      .forEach((agent, agentIndex) => {
        const anchor = standingAnchor(rect, agentIndex);
        targets.push(agentTarget(
          projection,
          agent,
          touchRect(
            anchor.x,
            anchor.nameY - 5,
            anchor.stationSpan - 4,
            anchor.characterFeetY - anchor.nameY + 10,
          ),
        ));
      });
  });

  return targets;
}

function touchRect(centerX: number, top: number, requestedWidth: number, requestedHeight: number): OfficeRect {
  const width = Math.max(MIN_OFFICE_TOUCH_TARGET, requestedWidth);
  const height = Math.max(MIN_OFFICE_TOUCH_TARGET, requestedHeight);
  return {
    x: centerX - width / 2,
    y: top,
    width,
    height,
  };
}

function agentTarget(
  projection: HerdrOfficeProjection,
  agent: OfficeAgent,
  rect: OfficeRect,
  desk?: OfficeDesk,
): OfficeSemanticTarget {
  const entry = projection.roster.find(({ agent: candidate }) => candidate.key === agent.key);
  const state = agent.stale
    ? "stale"
    : agent.stateLabels[agent.semanticStatus] ?? agent.semanticStatus;
  const location = desk
    ? `desk ${desk.displayLabel}, ${entry?.roomLabel ?? "Office"}`
    : entry?.roomLabel ?? "Office";
  const host = entry?.hostLabel ?? projection.hosts.find(({ key }) => key === agent.hostKey)?.displayLabel ?? "host";
  const summary = agent.taskSummary ? `, ${agent.taskSummary}` : "";
  return {
    key: agent.key,
    kind: "agent",
    label: `${agent.displayLabel}, ${state}, ${location}, ${host}${summary}`,
    rect,
    canActivate: agent.canOpenInSpaces,
  };
}

function deskTargetLabel(projection: HerdrOfficeProjection, desk: OfficeDesk) {
  const entry = projection.deskRoster.find(({ desk: candidate }) => candidate.key === desk.key);
  return `Empty desk ${desk.displayLabel}, ${entry?.roomLabel ?? "Office"}, ${entry?.hostLabel ?? "host"}`;
}

function roomTargetLabel(projection: HerdrOfficeProjection, room: OfficeRoom) {
  const entry = projection.roomRoster.find(({ key }) => key === room.key);
  return `Room ${room.accessibleLabel ?? room.displayLabel}, ${entry?.hostLabel ?? "host"}`;
}
