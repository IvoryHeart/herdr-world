import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "./herdrOfficeProjection";
import {
  agentBarSlot,
  deskAnchor,
  paneDeviceAnchor,
  deskStandingAnchor,
  OFFICE_GEOMETRY,
  receptionAgentAnchor,
  standingAnchor,
} from "./officeGeometry";
import type { OfficeRect } from "./officeGeometry";
import type { PublishedOfficeLayout } from "./officeLayout";

export const MIN_OFFICE_TOUCH_TARGET = 48;

export type OfficeSemanticTarget = {
  key: string;
  kind: "room" | "desk" | "agent" | "pane";
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
    const rect = layout.ceoBlocks.receptions.find(
      ({ index }) => index === receptionIndex,
    );
    if (!rect) {
      return;
    }
    reception.waitingAgents.forEach((agent, agentIndex) => {
      const anchor = receptionAgentAnchor(rect, agentIndex);
      targets.push(
        agentTarget(projection, agent, {
          x: anchor.x - (anchor.stationSpan - 2) / 2,
          y: anchor.nameY - (agentIndex < 4 ? 5 : 3),
          width: anchor.stationSpan - 2,
          height:
            anchor.characterFeetY +
            10 -
            (anchor.nameY - (agentIndex < 4 ? 5 : 3)),
        }),
      );
    });
  });

  projection.barAgents.forEach((agent, index) => {
    const slot = agentBarSlot(layout.ceoBlocks, index);
    targets.push(
      agentTarget(
        projection,
        agent,
        touchRect(
          slot.x,
          slot.rowY - 5,
          Math.max(MIN_OFFICE_TOUCH_TARGET, 52),
          slot.characterFeetY - slot.rowY + 10,
        ),
      ),
    );
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
        header?.titleBoxWidth ??
          rect.headerRect.width - OFFICE_GEOMETRY.roomHeaderChromeWidth,
      ),
    );
    targets.push({
      key: room.key,
      kind: "room",
      label: roomTargetLabel(projection, room),
      rect: touchRect(
        rect.headerRect.x +
          (header?.titleBoxX ?? (rect.headerRect.width - titleWidth) / 2) +
          titleWidth / 2,
        rect.headerRect.y -
          (MIN_OFFICE_TOUCH_TARGET - rect.headerRect.height) / 2,
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
      if (desk.paneDevices?.length) {
        targets.push({
          key: desk.key,
          kind: "desk",
          label: deskTargetLabel(projection, desk),
          rect: {
            x: anchor.x - OFFICE_GEOMETRY.deskWidth / 2,
            y: anchor.nameY - 5,
            width: OFFICE_GEOMETRY.deskWidth,
            height: 24,
          },
          canActivate: desk.canOpenInSpaces,
        });
        if (occupant)
          targets.push(
            agentTarget(
              projection,
              occupant,
              {
                x: anchor.x - 24,
                y: anchor.nameY + 22,
                width: 48,
                height: anchor.deskY - 28 - (anchor.nameY + 22),
              },
              desk,
            ),
          );
        desk.paneDevices.forEach((device, paneIndex) => {
          const point = paneDeviceAnchor(rect, deskIndex, paneIndex);
          targets.push({
            key: device.key,
            kind: "pane",
            label: `${device.displayLabel}, desk ${desk.displayLabel}, ${desk.observedPaneCount} panes${device.stale ? ", stale" : ""}`,
            rect: {
              x: point.x - point.width / 2,
              y: point.y - point.height / 2,
              width: point.width,
              height: point.height,
            },
            canActivate: device.canOpenInSpaces,
          });
        });
      } else {
        targets.push(
          occupant
            ? agentTarget(projection, occupant, stationRect, desk)
            : {
                key: desk.key,
                kind: "desk",
                label: deskTargetLabel(projection, desk),
                rect: stationRect,
                canActivate: desk.canOpenInSpaces,
              },
        );
      }
    });

    officeStandingAgentAnchors(room, rect).forEach(({ agent, anchor }) => {
      targets.push(
        agentTarget(
          projection,
          agent,
          "compact" in anchor
            ? {
                x: anchor.x - 12,
                y: anchor.characterFeetY - 42,
                width: 24,
                height: 28,
              }
            : touchRect(
                anchor.x,
                anchor.nameY - 5,
                48,
                anchor.characterFeetY - anchor.nameY + 10,
              ),
        ),
      );
    });
  });

  return targets;
}

function touchRect(
  centerX: number,
  top: number,
  requestedWidth: number,
  requestedHeight: number,
): OfficeRect {
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
  const entry = projection.roster.find(
    ({ agent: candidate }) => candidate.key === agent.key,
  );
  const state = agent.stale
    ? "stale"
    : (agent.stateLabels[agent.semanticStatus] ?? agent.semanticStatus);
  const location = desk
    ? `desk ${desk.displayLabel}, ${entry?.roomLabel ?? "Office"}`
    : (entry?.roomLabel ?? "Office");
  const host =
    entry?.hostLabel ??
    projection.hosts.find(({ key }) => key === agent.hostKey)?.displayLabel ??
    "host";
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
  const entry = projection.deskRoster.find(
    ({ desk: candidate }) => candidate.key === desk.key,
  );
  return `${desk.occupantAgentKey ? "Desk" : "Empty desk"} ${desk.displayLabel}, ${entry?.roomLabel ?? "Office"}, ${entry?.hostLabel ?? "host"}`;
}

function roomTargetLabel(projection: HerdrOfficeProjection, room: OfficeRoom) {
  const entry = projection.roomRoster.find(({ key }) => key === room.key);
  return `Room ${room.accessibleLabel ?? room.displayLabel}, ${entry?.hostLabel ?? "host"}`;
}

/** Share the exact grouping between canvas art and accessible targets. */
export function officeStandingAgentAnchors(
  room: OfficeRoom,
  rect: Parameters<typeof deskAnchor>[0],
) {
  const standing = room.roomAgents.filter(
    ({ placement }) => placement === "standing",
  );
  const grouped = new Set<string>();
  const result: Array<{
    agent: OfficeAgent;
    anchor:
      | ReturnType<typeof standingAnchor>
      | ReturnType<typeof deskStandingAnchor>;
  }> = [];
  room.desks.forEach((desk, deskIndex) => {
    if (!desk.paneDevices?.length) return;
    const agents = standing
      .filter(({ deskKey }) => deskKey === desk.key)
      .sort((left, right) => {
        const order = (agent: OfficeAgent) => {
          const index = desk.paneDevices.findIndex(
            ({ paneRef }) => paneRef.nativeId === agent.currentPaneRef.nativeId,
          );
          return index < 0 ? Number.MAX_SAFE_INTEGER : index;
        };
        return order(left) - order(right) || left.key.localeCompare(right.key);
      });
    agents.slice(0, 2).forEach((agent, index) => {
      grouped.add(agent.key);
      result.push({
        agent,
        anchor: deskStandingAnchor(rect, deskIndex, index),
      });
    });
  });
  standing
    .filter(({ key }) => !grouped.has(key))
    .forEach((agent, index) =>
      result.push({ agent, anchor: standingAnchor(rect, index) }),
    );
  return result;
}
