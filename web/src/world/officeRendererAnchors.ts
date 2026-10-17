/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import type {
  HerdrOfficeProjection,
  OfficeDesk,
} from "./herdrOfficeProjection";
import {
  agentBarSlot,
  deskAnchor,
  receptionAgentAnchor,
} from "./officeGeometry";
import type { OfficeLayout } from "./officeGeometry";
import { officeStandingAgentAnchors } from "./officeSemanticTargets";
import {
  type OfficeRendererAnchor,
  type OfficeRendererAnchors,
} from "./officeRendererTypes";

export function resolveOfficeAnchors(
  projection: HerdrOfficeProjection,
  layout: OfficeLayout,
  selectedKey: string | null,
  conversationTargetKey: string | null,
): OfficeRendererAnchors {
  const agentEntry = selectedKey
    ? (projection.roster.find(({ agent }) => agent.key === selectedKey) ?? null)
    : null;
  const pane = projection.paneRoster.find(
    ({ device }) =>
      device.key === conversationTargetKey || device.key === selectedKey,
  )?.device;
  const paneDesk = pane
    ? (projection.deskRoster.find(({ desk }) => desk.key === pane.deskKey)
        ?.desk ?? null)
    : null;
  const directDesk = conversationTargetKey
    ? (projection.deskRoster.find(
        ({ desk }) => desk.key === conversationTargetKey,
      )?.desk ?? null)
    : null;
  const selectedDesk =
    !agentEntry && selectedKey
      ? (projection.deskRoster.find(({ desk }) => desk.key === selectedKey)
          ?.desk ?? null)
      : null;
  const agentDesk = agentEntry?.agent.deskKey
    ? (projection.deskRoster.find(
        ({ desk }) => desk.key === agentEntry.agent.deskKey,
      )?.desk ?? null)
    : null;
  return {
    agent: agentEntry
      ? resolveOfficeAgentAnchor(projection, layout, agentEntry.agent.key)
      : null,
    workbench: resolveOfficeDeskAnchor(
      projection,
      layout,
      directDesk ?? paneDesk ?? agentDesk ?? selectedDesk,
    ),
  };
}

function resolveOfficeDeskAnchor(
  projection: HerdrOfficeProjection,
  layout: OfficeLayout,
  desk: OfficeDesk | null,
): OfficeRendererAnchor | null {
  if (!desk) {
    return null;
  }
  const roomIndex = projection.rooms.findIndex(
    ({ key }) => key === desk.roomKey,
  );
  const room = projection.rooms[roomIndex];
  const rect = layout.rooms.find(({ index }) => index === roomIndex);
  if (!room || !rect) {
    return null;
  }
  const deskIndex = room.desks.findIndex(({ key }) => key === desk.key);
  if (deskIndex < 0) {
    return null;
  }
  const anchor = deskAnchor(rect, deskIndex);
  return { x: anchor.x, y: anchor.deskY + 10 };
}

function resolveOfficeAgentAnchor(
  projection: HerdrOfficeProjection,
  layout: OfficeLayout,
  key: string,
): OfficeRendererAnchor | null {
  const entry = projection.roster.find(({ agent }) => agent.key === key);
  if (!entry) {
    return null;
  }
  const agent = entry.agent;
  if (agent.destination === "reception") {
    const receptionIndex = projection.receptions.findIndex(
      (reception) => reception.hostKey === agent.hostKey,
    );
    const reception = projection.receptions[receptionIndex];
    const rect = layout.ceoBlocks.receptions[receptionIndex];
    if (!reception || !rect) {
      return null;
    }
    const index = reception.waitingAgents.findIndex(
      ({ key: agentKey }) => agentKey === key,
    );
    if (index < 0) {
      return null;
    }
    const anchor = receptionAgentAnchor(rect, index);
    return { x: anchor.x, y: anchor.characterFeetY - 42 };
  }
  if (agent.destination === "bar") {
    const barIndex = projection.barAgents.findIndex(
      ({ key: agentKey }) => agentKey === key,
    );
    if (barIndex < 0) {
      return null;
    }
    const slot = agentBarSlot(layout.ceoBlocks, barIndex);
    return { x: slot.x, y: slot.characterFeetY - 42 };
  }
  const roomIndex = projection.rooms.findIndex(
    ({ key: roomKey }) => roomKey === agent.roomKey,
  );
  const room = projection.rooms[roomIndex];
  const rect = layout.rooms.find(({ index }) => index === roomIndex);
  if (!room || !rect) {
    return null;
  }
  if (agent.placement === "seated") {
    const deskIndex = room.desks.findIndex(
      ({ occupantAgentKey }) => occupantAgentKey === key,
    );
    if (deskIndex >= 0) {
      const anchor = deskAnchor(rect, deskIndex);
      return { x: anchor.x, y: anchor.characterFeetY - 42 };
    }
  }
  const standing = officeStandingAgentAnchors(room, rect).find(
    ({ agent }) => agent.key === key,
  );
  if (standing)
    return { x: standing.anchor.x, y: standing.anchor.characterFeetY - 42 };
  return null;
}
