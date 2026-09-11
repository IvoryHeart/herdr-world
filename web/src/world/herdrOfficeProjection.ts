import type { HostConnectionState } from "../runtimeClient";
import { qualifiedRuntimeKey } from "../runtimeIdentity";
import type { QualifiedTarget } from "../runtimeIdentity";
import type { AgentStatus, WorkspaceInfo } from "../types";
import { stableNumber } from "./worldModel";
import type {
  WorldHostLocation,
  WorldHostNode,
  WorldLeafNode,
  WorldModel,
  WorldTab,
} from "./worldModel";

export const OFFICE_PRESENTATION_BOUNDS = Object.freeze({
  rooms: 128,
  desksPerRoom: 8,
  roomAgentsPerRoom: 16,
  receptionDesks: 6,
  waitingAgentsPerReception: 4,
  barAgents: 16,
  rosterPage: 50,
});

const CHARACTER_COUNT = 12;
const HOST_THEME_COUNT = 6;
const MAX_VISIBLE_LABEL = 80;
const MAX_STATE_LABEL = 96;

export type OfficeHostSkin = {
  themeIndex: number;
  badge: string;
};

export type OfficeHost = {
  key: string;
  displayLabel: string;
  /** Full display-safe source label for semantic DOM; canvas text uses displayLabel/geometry fitting. */
  accessibleLabel?: string;
  displayOrder: number;
  location: WorldHostLocation;
  connectionState: HostConnectionState;
  observed: boolean;
  stale: boolean;
  compatibleWithWorld: boolean;
  compatibleWithSpaces: boolean;
  deterministicSkin: OfficeHostSkin;
};

export type OfficeAgentDestination = "room" | "reception" | "bar";
export type OfficeAgentPlacement = "seated" | "standing" | "waiting" | "bar";

export type OfficeAgent = {
  key: string;
  currentPaneRef: QualifiedTarget;
  currentTerminalRef: QualifiedTarget;
  currentTabRef: QualifiedTarget;
  deskKey: string | null;
  observedGeneration: string;
  roomKey: string;
  hostKey: string;
  displayLabel: string;
  taskSummary?: string;
  semanticStatus: AgentStatus;
  stateLabels: Partial<Record<AgentStatus, string>>;
  focused: boolean;
  destination: OfficeAgentDestination;
  placement: OfficeAgentPlacement;
  stale: boolean;
  canOpenInSpaces: boolean;
  characterIndex: number;
};

export type OfficeDesk = {
  key: string;
  hostKey: string;
  roomKey: string;
  tabRef: QualifiedTarget;
  terminalSelectionKeys: string[];
  observedGeneration: string;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  occupantAgentKey?: string;
  completionAgentKeys: string[];
};

export type OfficeRoom = {
  key: string;
  hostKey: string;
  workspaceRef: QualifiedTarget;
  observedGeneration: string;
  displayLabel: string;
  /** Full display-safe source label for semantic DOM and measured room geometry. */
  accessibleLabel?: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  desks: OfficeDesk[];
  roomAgents: OfficeAgent[];
  omittedDeskCount: number;
  omittedAgentCount: number;
  observedDeskCount: number;
  observedAgentCount: number;
};

export type OfficeReception = {
  key: string;
  hostKey: string;
  hostLabel: string;
  stale: boolean;
  waitingAgents: OfficeAgent[];
  observedWaitingAgentCount: number;
  overflowCount: number;
};

export type OfficeRosterEntry = {
  agent: OfficeAgent;
  roomKey: string;
  roomLabel: string;
  hostKey: string;
  hostLabel: string;
  roomPresented: boolean;
  deskPresented: boolean;
  destinationPresented: boolean;
};

export type OfficeDeskRosterEntry = {
  desk: OfficeDesk;
  roomLabel: string;
  hostLabel: string;
  presented: boolean;
};

export type OfficeRoomRosterEntry = {
  key: string;
  hostKey: string;
  hostLabel: string;
  workspaceRef: QualifiedTarget;
  observedGeneration: string;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  presented: boolean;
};

export type OfficeCoverage = {
  configuredHosts: number;
  observedHosts: number;
  compatibleHosts: number;
  connectingHosts: number;
  staleHosts: number;
  incompatibleHosts: number;
  disabledHosts: number;
  observedWorkspaces: number;
  observedDesks: number;
  observedAgents: number;
  status: Record<AgentStatus, number>;
  omittedRooms: number;
  omittedDesks: number;
  omittedRoomAgents: number;
  omittedReceptionDesks: number;
  omittedWaitingAgents: number;
  omittedBarAgents: number;
};

export type OfficePresentationBounds = typeof OFFICE_PRESENTATION_BOUNDS & {
  totalRooms: number;
  renderedRooms: number;
  totalDesks: number;
  renderedDesks: number;
  totalRoomAgents: number;
  renderedRoomAgents: number;
  totalReceptionDesks: number;
  renderedReceptionDesks: number;
  totalWaitingAgents: number;
  renderedWaitingAgents: number;
  totalBarAgents: number;
  renderedBarAgents: number;
};

export type OfficeUnresolved = {
  kind: "room-bound";
  count: number;
};

export type HerdrOfficeProjection = {
  version: 1;
  generatedAt: number;
  hosts: OfficeHost[];
  rooms: OfficeRoom[];
  receptions: OfficeReception[];
  barAgents: OfficeAgent[];
  roomRoster: OfficeRoomRosterEntry[];
  deskRoster: OfficeDeskRosterEntry[];
  roster: OfficeRosterEntry[];
  unresolved: OfficeUnresolved[];
  coverage: OfficeCoverage;
  presentationBounds: OfficePresentationBounds;
};

type ProjectedHost = {
  modelHost: WorldHostNode;
  host: OfficeHost;
};

type ProjectedRoom = {
  host: OfficeHost;
  workspace: WorkspaceInfo;
  room: Omit<
    OfficeRoom,
    | "desks"
    | "roomAgents"
    | "omittedDeskCount"
    | "omittedAgentCount"
    | "observedDeskCount"
    | "observedAgentCount"
  >;
  desks: OfficeDesk[];
  agents: OfficeAgent[];
};

export function projectHerdrOffice(
  model: WorldModel,
  generatedAt: number,
): HerdrOfficeProjection {
  const projectedHosts = model.hosts.map(projectHost);
  const allRooms = projectedHosts.flatMap(projectRooms).sort(compareProjectedRooms);
  const presentedRoomKeys = new Set(
    allRooms.slice(0, OFFICE_PRESENTATION_BOUNDS.rooms).map(({ room }) => room.key),
  );
  const allAgents = allRooms.flatMap(({ agents }) => agents);
  const allDesks = allRooms.flatMap(({ desks }) => desks);

  const rooms = allRooms.slice(0, OFFICE_PRESENTATION_BOUNDS.rooms).map((entry) => {
    const presentedDesks = entry.desks.slice(0, OFFICE_PRESENTATION_BOUNDS.desksPerRoom);
    const occupantKeys = new Set(
      presentedDesks.flatMap(({ occupantAgentKey }) => occupantAgentKey ? [occupantAgentKey] : []),
    );
    const roomLocalAgents = entry.agents
      .filter(({ destination }) => destination === "room")
      .map((agent) => ({
        ...agent,
        placement: occupantKeys.has(agent.key) ? "seated" as const : "standing" as const,
      }))
      .sort((left, right) => comparePresentedRoomAgents(left, right, presentedDesks));
    return {
      ...entry.room,
      desks: presentedDesks,
      roomAgents: roomLocalAgents.slice(0, OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom),
      omittedDeskCount: Math.max(0, entry.desks.length - OFFICE_PRESENTATION_BOUNDS.desksPerRoom),
      omittedAgentCount: Math.max(
        0,
        roomLocalAgents.length - OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
      ),
      observedDeskCount: entry.desks.length,
      observedAgentCount: entry.agents.length,
    };
  });

  const roomByKey = new Map(rooms.map((room) => [room.key, room]));
  const visibleHosts = projectedHosts.filter(({ modelHost }) => modelHost.source.profile.enabled);
  const receptions = visibleHosts
    .slice(0, OFFICE_PRESENTATION_BOUNDS.receptionDesks)
    .map(({ host }) => {
      const waiting = allAgents
        .filter(({ hostKey, destination }) => hostKey === host.key && destination === "reception")
        .sort(compareOfficeAgents);
      return {
        key: `reception:${host.key}`,
        hostKey: host.key,
        hostLabel: host.displayLabel,
        stale: host.stale,
        waitingAgents: waiting.slice(0, OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception),
        observedWaitingAgentCount: waiting.length,
        overflowCount: Math.max(
          0,
          waiting.length - OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
        ),
      };
    });
  const barCandidates = allAgents
    .filter(({ destination }) => destination === "bar")
    .sort(compareBarAgents);
  const barAgents = barCandidates.slice(0, OFFICE_PRESENTATION_BOUNDS.barAgents);
  const presentedBarKeys = new Set(barAgents.map(({ key }) => key));
  const presentedWaitingKeys = new Set(
    receptions.flatMap(({ waitingAgents }) => waitingAgents.map(({ key }) => key)),
  );
  const presentedRoomAgentKeys = new Set(
    rooms.flatMap(({ roomAgents }) => roomAgents.map(({ key }) => key)),
  );

  const roomRoster = allRooms.map((entry) => ({
    key: entry.room.key,
    hostKey: entry.host.key,
    hostLabel: entry.host.displayLabel,
    workspaceRef: entry.room.workspaceRef,
    observedGeneration: entry.room.observedGeneration,
    displayLabel: entry.room.displayLabel,
    order: entry.room.order,
    stale: entry.room.stale,
    canOpenInSpaces: entry.room.canOpenInSpaces,
    presented: presentedRoomKeys.has(entry.room.key),
  }));
  const deskRoster = allRooms.flatMap((entry) =>
    entry.desks.map((desk) => ({
      desk,
      roomLabel: entry.room.displayLabel,
      hostLabel: entry.host.displayLabel,
      presented: Boolean(roomByKey.get(entry.room.key)?.desks.some(({ key }) => key === desk.key)),
    })),
  );
  const roster = allRooms.flatMap((entry) =>
    entry.agents.map((agent) => {
      const presentedRoom = roomByKey.get(entry.room.key);
      const projectedAgent = presentedRoom?.roomAgents.find(({ key }) => key === agent.key) ?? agent;
      const destinationPresented = agent.destination === "room"
        ? presentedRoomAgentKeys.has(agent.key)
        : agent.destination === "reception"
          ? presentedWaitingKeys.has(agent.key)
          : presentedBarKeys.has(agent.key);
      return {
        agent: projectedAgent,
        roomKey: entry.room.key,
        roomLabel: entry.room.displayLabel,
        hostKey: entry.host.key,
        hostLabel: entry.host.displayLabel,
        roomPresented: presentedRoomKeys.has(entry.room.key),
        deskPresented: Boolean(
          agent.deskKey && presentedRoom?.desks.some(({ key }) => key === agent.deskKey),
        ),
        destinationPresented,
      };
    }),
  );

  const omittedRooms = Math.max(0, allRooms.length - OFFICE_PRESENTATION_BOUNDS.rooms);
  const omittedDesks = allRooms.reduce((count, entry) => {
    if (!presentedRoomKeys.has(entry.room.key)) {
      return count + entry.desks.length;
    }
    return count + Math.max(0, entry.desks.length - OFFICE_PRESENTATION_BOUNDS.desksPerRoom);
  }, 0);
  const roomCandidates = allAgents.filter(({ destination }) => destination === "room");
  const waitingCandidates = allAgents.filter(({ destination }) => destination === "reception");
  const renderedDesks = rooms.reduce((count, room) => count + room.desks.length, 0);
  const renderedRoomAgents = rooms.reduce((count, room) => count + room.roomAgents.length, 0);
  const renderedWaitingAgents = receptions.reduce(
    (count, reception) => count + reception.waitingAgents.length,
    0,
  );
  const staleHosts = projectedHosts.filter(({ host }) => host.stale).length;

  return {
    version: 1,
    generatedAt,
    hosts: projectedHosts.map(({ host }) => host),
    rooms,
    receptions,
    barAgents,
    roomRoster,
    deskRoster,
    roster,
    unresolved: omittedRooms ? [{ kind: "room-bound", count: omittedRooms }] : [],
    coverage: {
      configuredHosts: projectedHosts.length,
      observedHosts: projectedHosts.filter(({ modelHost }) => modelHost.source.snapshot !== null).length,
      compatibleHosts: projectedHosts.filter(({ host }) => host.compatibleWithWorld).length,
      connectingHosts: projectedHosts.filter(
        ({ modelHost }) => modelHost.source.connectionState === "connecting",
      ).length,
      staleHosts,
      incompatibleHosts: projectedHosts.filter(
        ({ modelHost }) => modelHost.source.connectionState === "incompatible",
      ).length,
      disabledHosts: projectedHosts.filter(({ modelHost }) => !modelHost.source.profile.enabled).length,
      observedWorkspaces: allRooms.length,
      observedDesks: allDesks.length,
      observedAgents: allAgents.length,
      status: countStatuses(allAgents),
      omittedRooms,
      omittedDesks,
      omittedRoomAgents: Math.max(0, roomCandidates.length - renderedRoomAgents),
      omittedReceptionDesks: Math.max(
        0,
        visibleHosts.length - OFFICE_PRESENTATION_BOUNDS.receptionDesks,
      ),
      omittedWaitingAgents: Math.max(0, waitingCandidates.length - renderedWaitingAgents),
      omittedBarAgents: Math.max(0, barCandidates.length - barAgents.length),
    },
    presentationBounds: {
      ...OFFICE_PRESENTATION_BOUNDS,
      totalRooms: allRooms.length,
      renderedRooms: rooms.length,
      totalDesks: allDesks.length,
      renderedDesks,
      totalRoomAgents: roomCandidates.length,
      renderedRoomAgents,
      totalReceptionDesks: visibleHosts.length,
      renderedReceptionDesks: receptions.length,
      totalWaitingAgents: waitingCandidates.length,
      renderedWaitingAgents,
      totalBarAgents: barCandidates.length,
      renderedBarAgents: barAgents.length,
    },
  };
}

function projectHost(modelHost: WorldHostNode): ProjectedHost {
  const { source } = modelHost;
  const featureSet = new Set(source.features);
  const enabled = source.profile.enabled;
  const incompatible = source.connectionState === "incompatible";
  const compatibleWithWorld = enabled && !incompatible && featureSet.has("snapshot");
  const compatibleWithSpaces = compatibleWithWorld && featureSet.has("terminal_attach");
  const stale = source.snapshot !== null && source.connectionState !== "compatible";
  const seed = stableNumber(source.profile.profileId);
  return {
    modelHost,
    host: {
      key: source.profile.profileId,
      displayLabel: boundedLabel(source.profile.label, "Host"),
      accessibleLabel: normalizedLabel(source.profile.label, "Host"),
      displayOrder: source.profile.displayOrder,
      location: source.location,
      connectionState: enabled ? source.connectionState : "disabled",
      observed: source.snapshot !== null,
      stale,
      compatibleWithWorld,
      compatibleWithSpaces,
      deterministicSkin: {
        themeIndex: seed % HOST_THEME_COUNT,
        badge: `HOST ${String(source.profile.displayOrder + 1).padStart(2, "0")}`,
      },
    },
  };
}

function projectRooms({ modelHost, host }: ProjectedHost): ProjectedRoom[] {
  const { source } = modelHost;
  if (!source.profile.enabled || !source.snapshot) {
    return [];
  }
  return modelHost.spaces.map((space) => {
    const { workspace, workspaceRef } = space;
    const roomKey = space.id;
    const canOpenInSpaces =
      host.compatibleWithSpaces &&
      !host.stale &&
      source.connectionState === "compatible" &&
      Boolean(source.generationKey);
    const desks = space.tabs
      .map((tab) => projectDesk(
        modelHost,
        host,
        roomKey,
        tab,
        space.children
          .filter(({ tabRef }) => tabRef.nativeTargetId === tab.tab.tab_id)
          .map(({ terminalRef }) => qualifiedRuntimeKey(terminalRef))
          .sort(),
        canOpenInSpaces,
      ))
      .sort(compareOfficeDesks);
    const deskKeys = new Set(desks.map(({ key }) => key));
    const agents = space.children
      .filter((child): child is WorldLeafNode & { kind: "agent" } => child.kind === "agent")
      .map((agent) => projectAgent(modelHost, host, roomKey, agent, canOpenInSpaces, deskKeys))
      .sort(compareOfficeAgents);
    const roomLocalByDesk = new Map<string, OfficeAgent[]>();
    for (const agent of agents) {
      if (agent.destination !== "room" || !agent.deskKey) {
        continue;
      }
      const candidates = roomLocalByDesk.get(agent.deskKey) ?? [];
      candidates.push(agent);
      roomLocalByDesk.set(agent.deskKey, candidates);
    }
    for (const desk of desks) {
      const occupant = (roomLocalByDesk.get(desk.key) ?? []).sort(compareDeskCandidates)[0];
      if (occupant) {
        desk.occupantAgentKey = occupant.key;
      }
      desk.completionAgentKeys = agents
        .filter((agent) => agent.semanticStatus === "done" && agent.deskKey === desk.key)
        .map(({ key }) => key)
        .sort();
    }
    return {
      host,
      workspace,
      room: {
        key: roomKey,
        hostKey: host.key,
        workspaceRef,
        observedGeneration: source.generationKey ?? "",
        displayLabel: boundedLabel(workspace.label, "Workspace"),
        accessibleLabel: normalizedLabel(workspace.label, "Workspace"),
        order: workspace.number,
        stale: host.stale,
        canOpenInSpaces,
      },
      desks,
      agents,
    };
  });
}

function projectDesk(
  modelHost: WorldHostNode,
  host: OfficeHost,
  roomKey: string,
  worldTab: WorldTab,
  terminalSelectionKeys: string[],
  canOpenInSpaces: boolean,
): OfficeDesk {
  const { tab, tabRef } = worldTab;
  return {
    key: worldTab.id,
    hostKey: host.key,
    roomKey,
    tabRef,
    terminalSelectionKeys,
    observedGeneration: modelHost.source.generationKey ?? "",
    displayLabel: boundedLabel(tab.label, `Tab ${tab.number}`),
    order: tab.number,
    stale: host.stale,
    canOpenInSpaces,
    completionAgentKeys: [],
  };
}

function projectAgent(
  modelHost: WorldHostNode,
  host: OfficeHost,
  roomKey: string,
  leaf: WorldLeafNode & { kind: "agent" },
  canOpenInSpaces: boolean,
  deskKeys: ReadonlySet<string>,
): OfficeAgent {
  const { pane, paneRef, terminalRef, tabRef } = leaf;
  const key = leaf.id;
  const deskKey = qualifiedRuntimeKey(tabRef);
  const destination = statusDestination(pane.agent_status);
  const taskSummary = boundedSummary(pane.task_summary);
  return {
    key,
    currentPaneRef: paneRef,
    currentTerminalRef: terminalRef,
    currentTabRef: tabRef,
    deskKey: deskKeys.has(deskKey) ? deskKey : null,
    observedGeneration: modelHost.source.generationKey ?? "",
    roomKey,
    hostKey: host.key,
    displayLabel: boundedLabel(pane.display_agent || pane.agent, "Agent"),
    ...(taskSummary ? { taskSummary } : {}),
    semanticStatus: pane.agent_status,
    stateLabels: boundedStateLabels(pane.state_labels),
    focused: pane.focused,
    destination,
    placement: destination === "room" ? "standing" : destination === "reception" ? "waiting" : "bar",
    stale: host.stale,
    canOpenInSpaces,
    characterIndex: stableNumber(key) % CHARACTER_COUNT,
  };
}

function statusDestination(status: AgentStatus): OfficeAgentDestination {
  if (status === "working" || status === "unknown") {
    return "room";
  }
  return status === "blocked" ? "reception" : "bar";
}

function boundedSummary(value: string | undefined) {
  const summary = value?.trim();
  if (!summary) {
    return null;
  }
  return summary.length > 160 ? `${summary.slice(0, 157).trimEnd()}…` : summary;
}

function compareProjectedRooms(left: ProjectedRoom, right: ProjectedRoom) {
  return (
    left.host.displayOrder - right.host.displayOrder ||
    left.host.key.localeCompare(right.host.key) ||
    left.workspace.number - right.workspace.number ||
    left.room.key.localeCompare(right.room.key)
  );
}

function compareOfficeDesks(left: OfficeDesk, right: OfficeDesk) {
  return left.order - right.order || left.key.localeCompare(right.key);
}

function compareDeskCandidates(left: OfficeAgent, right: OfficeAgent) {
  return (
    roomStatusOrder(left.semanticStatus) - roomStatusOrder(right.semanticStatus) ||
    Number(right.focused) - Number(left.focused) ||
    left.key.localeCompare(right.key)
  );
}

function comparePresentedRoomAgents(
  left: OfficeAgent,
  right: OfficeAgent,
  desks: readonly OfficeDesk[],
) {
  const deskOrder = new Map(desks.map((desk, index) => [desk.key, index]));
  return (
    Number(left.placement !== "seated") - Number(right.placement !== "seated") ||
    (deskOrder.get(left.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (deskOrder.get(right.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) ||
    compareDeskCandidates(left, right)
  );
}

function compareOfficeAgents(left: OfficeAgent, right: OfficeAgent) {
  return left.key.localeCompare(right.key);
}

function compareBarAgents(left: OfficeAgent, right: OfficeAgent) {
  return barStatusOrder(left.semanticStatus) - barStatusOrder(right.semanticStatus) ||
    left.key.localeCompare(right.key);
}

function roomStatusOrder(status: AgentStatus) {
  return status === "working" ? 0 : status === "unknown" ? 1 : 2;
}

function barStatusOrder(status: AgentStatus) {
  return status === "idle" ? 0 : status === "done" ? 1 : 2;
}

function countStatuses(agents: readonly OfficeAgent[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = {
    working: 0,
    idle: 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  };
  for (const agent of agents) {
    counts[agent.semanticStatus] += 1;
  }
  return counts;
}

function boundedStateLabels(
  labels: Record<string, string> | undefined,
): Partial<Record<AgentStatus, string>> {
  const result: Partial<Record<AgentStatus, string>> = {};
  for (const status of ["working", "idle", "blocked", "done", "unknown"] as const) {
    const value = labels?.[status];
    if (value) {
      result[status] = boundedLabel(value, status, MAX_STATE_LABEL);
    }
  }
  return result;
}

function boundedLabel(value: string | null | undefined, fallback: string, limit = MAX_VISIBLE_LABEL) {
  const normalized = normalizedLabel(value, fallback);
  const points = [...normalized];
  if (points.length <= limit) {
    return normalized;
  }
  return `${points.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

function normalizedLabel(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}
