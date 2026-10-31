import type {
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "./officeProjectionTypes";
import type { OfficePresentationBounds } from "./herdrOfficeProjection";
import { TOWN_PRESENTATION_BOUNDS } from "./herdrOfficeProjection";
import { boundedDesks, boundedWithPriority } from "./officeDesks";
import {
  projectPaneDevices,
  compareDeskCandidates,
  type ProjectedRoom,
} from "./officeRoom";
import { DEVTOOLS } from "./devtools/flag";
import { countWorldWork } from "./devtools/renderer";
const cache = new WeakMap<
  ProjectedRoom["source"],
  { key: string; room: OfficeRoom }
>();

export function presentOfficeRoom(
  entry: ProjectedRoom,
  bounds: OfficePresentationBounds,
  expanded: boolean,
  deskRenderLimit: number,
  selectedSpaceId: string | null | undefined,
  selectedId: string | null,
  selectedLeaf: { tabId: string } | undefined,
  pinned: (desk: OfficeDesk) => boolean,
): OfficeRoom {
  const key = JSON.stringify([
    bounds,
    bounds === TOWN_PRESENTATION_BOUNDS,
    expanded,
    deskRenderLimit,
    entry.source.id === selectedSpaceId ? selectedId : null,
    entry.desks.filter(pinned).map((d) => d.key),
  ]);
  const previous = cache.get(entry.source);
  if (previous?.key === key) return previous.room;
  if (DEVTOOLS) countWorldWork("office.room-project");
  const folds = entry.desks.length > bounds.foldedDesksPerRoom;
  const desks = boundedDesks(
    entry.desks,
    entry.agents,
    deskRenderLimit,
    (desk) =>
      entry.source.id === selectedSpaceId &&
      desk.tabRef.nativeId === selectedLeaf?.tabId,
    pinned,
    bounds === TOWN_PRESENTATION_BOUNDS,
  );
  const presentedDesks = desks.map((desk) => {
    const devices = boundedWithPriority(
      projectPaneDevices(entry.source.children, desk),
      bounds.paneDevicesPerDesk,
      (device) => device.nodeId === selectedId,
    );
    return {
      ...desk,
      paneDevices: devices,
      omittedPaneCount: Math.max(0, desk.observedPaneCount - devices.length),
    };
  });
  const seated = new Set(
    presentedDesks.flatMap(({ occupantAgentKey }) =>
      occupantAgentKey ? [occupantAgentKey] : [],
    ),
  );
  const deskOrder = new Map(
    presentedDesks.map((desk, index) => [desk.key, index]),
  );
  // A pinned desk keeps its agents too.
  const pinnedDesks = new Set(
    presentedDesks.filter(pinned).map((desk) => desk.key),
  );
  const keptAgent = (agent: { key: string; deskKey: string | null }) =>
    agent.key === selectedId ||
    (agent.deskKey !== null && pinnedDesks.has(agent.deskKey));
  const roomAgents = entry.agents
    .filter(({ destination }) => destination === "room")
    .map((agent) => ({
      ...agent,
      placement: seated.has(agent.key)
        ? ("seated" as const)
        : ("standing" as const),
    }))
    .sort((left, right) => compareRoomAgents(left, right, deskOrder));
  // Like their desks, the selected and pinned desks' agents stay past the
  // bound.
  const shownAgents = boundedWithPriority(
    roomAgents,
    Math.max(bounds.roomAgentsPerRoom, roomAgents.filter(keptAgent).length),
    keptAgent,
    (agent) => agent.key === selectedId,
  );
  const result: OfficeRoom = {
    ...entry.room,
    desks: presentedDesks,
    roomAgents: shownAgents,
    omittedDeskCount: Math.max(
      0,
      entry.source.coverage.tabs - presentedDesks.length,
    ),
    ...(folds || expanded
      ? { deskFold: expanded ? ("expanded" as const) : ("folded" as const) }
      : {}),
    omittedAgentCount: Math.max(
      0,
      entry.source.coverage.status.working +
        entry.source.coverage.status.unknown -
        shownAgents.length,
    ),
    observedDeskCount: entry.source.coverage.tabs,
    observedAgentCount: entry.source.coverage.agents,
    deskRenderLimit,
  };
  cache.set(entry.source, { key, room: result });
  return result;
}
function compareRoomAgents(
  left: OfficeAgent,
  right: OfficeAgent,
  order: ReadonlyMap<string, number>,
) {
  return (
    Number(left.placement !== "seated") -
      Number(right.placement !== "seated") ||
    (order.get(left.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) ||
    compareDeskCandidates(left, right)
  );
}
