import type { AgentStatus } from "../types";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDeskRosterEntry,
  OfficeHost,
  OfficeRoomRosterEntry,
  OfficeRosterEntry,
} from "./herdrOfficeProjection";

export type OfficeCallout = {
  kind: "agent" | "desk" | "room" | "host";
  title: string;
  detail: string;
  summary?: string;
  status: AgentStatus | "stale" | null;
};

export type OfficeSelection =
  | {
      kind: "agent";
      agent: OfficeAgent;
      entry: OfficeRosterEntry;
    }
  | {
      kind: "desk";
      desk: OfficeDeskRosterEntry;
    }
  | {
      kind: "room";
      room: OfficeRoomRosterEntry;
    }
  | {
      kind: "host";
      host: OfficeHost;
  };

export type OfficeSeatAvailabilityReason = "host" | "workspace" | "capability" | null;

export function officeSeatAvailability(
  hasSelectedHost: boolean,
  hasActiveWorkspace: boolean,
  canCreateTab: boolean,
) {
  if (!hasSelectedHost) {
    return { supported: false, reason: "host" as const };
  }
  if (!hasActiveWorkspace) {
    return { supported: false, reason: "workspace" as const };
  }
  if (!canCreateTab) {
    return { supported: false, reason: "capability" as const };
  }
  return { supported: true, reason: null as OfficeSeatAvailabilityReason };
}

export function officeCalloutForKey(
  projection: HerdrOfficeProjection,
  key: string,
): OfficeCallout | null {
  key = officePresentationKey(projection, key) ?? key;
  const agentEntry = projection.roster.find(({ agent }) => agent.key === key);
  if (agentEntry) {
    const { agent } = agentEntry;
    return {
      kind: "agent",
      title: agent.displayLabel,
      detail: `${agent.stale ? "stale" : agent.stateLabels[agent.semanticStatus] ?? agent.semanticStatus} · ${agentEntry.roomLabel} · ${agentEntry.hostLabel}`,
      ...(agent.taskSummary ? { summary: agent.taskSummary } : {}),
      status: agent.stale ? "stale" : agent.semanticStatus,
    };
  }

  const deskEntry = projection.deskRoster.find(({ desk }) => desk.key === key);
  if (deskEntry) {
    const occupant = deskEntry.desk.occupantAgentKey
      ? projection.roster.find(({ agent }) => agent.key === deskEntry.desk.occupantAgentKey)?.agent
      : null;
    return {
      kind: "desk",
      title: deskEntry.desk.displayLabel,
      detail: `${occupant ? `${occupant.displayLabel} · ${occupant.stale ? "stale" : occupant.semanticStatus}` : "empty desk"} · ${deskEntry.roomLabel} · ${deskEntry.hostLabel}`,
      ...(occupant?.taskSummary ? { summary: occupant.taskSummary } : {}),
      status: deskEntry.desk.stale ? "stale" : occupant?.semanticStatus ?? null,
    };
  }

  const room = projection.roomRoster.find((entry) => entry.key === key);
  if (room) {
    const roomProjection = projection.rooms.find((entry) => entry.key === key);
    return {
      kind: "room",
      title: room.displayLabel,
      detail: `${room.stale ? "stale" : `${roomProjection?.desks.length ?? 0} desks · ${roomProjection?.roomAgents.length ?? 0} agents`} · ${room.hostLabel}`,
      status: room.stale ? "stale" : null,
    };
  }

  const host = projection.hosts.find((entry) => entry.key === key);
  if (host) {
    return {
      kind: "host",
      title: host.displayLabel,
      detail: `${host.connectionState} · ${host.observed ? "live Office state" : "not observed"}`,
      status: host.stale ? "stale" : null,
    };
  }

  return null;
}

export function findOfficeSelection(
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
): OfficeSelection | null {
  selectedKey = officePresentationKey(projection, selectedKey);
  if (!selectedKey) {
    return null;
  }
  const agent = projection.roster.find(({ agent: entry }) => entry.key === selectedKey);
  if (agent) {
    return { kind: "agent", agent: agent.agent, entry: agent };
  }
  const desk = projection.deskRoster.find(({ desk: entry }) => entry.key === selectedKey);
  if (desk) {
    return { kind: "desk", desk };
  }
  const room = projection.roomRoster.find((entry) => entry.key === selectedKey);
  if (room) {
    return { kind: "room", room };
  }
  const host = projection.hosts.find((entry) => entry.key === selectedKey);
  return host ? { kind: "host", host } : null;
}

export function officePresentationKey(
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
) {
  if (!selectedKey) {
    return null;
  }
  if (
    projection.roster.some(({ agent }) => agent.key === selectedKey) ||
    projection.deskRoster.some(({ desk }) => desk.key === selectedKey) ||
    projection.roomRoster.some(({ key }) => key === selectedKey) ||
    projection.hosts.some(({ key }) => key === selectedKey)
  ) {
    return selectedKey;
  }
  return projection.deskRoster.find(({ desk }) =>
    desk.terminalSelectionKeys.includes(selectedKey)
  )?.desk.key ?? selectedKey;
}

export function formatOfficeActivityAge(timestamp: number | undefined, now = Date.now()) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return null;
  }
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 1_000) {
    return "just now";
  }
  if (elapsed < 60_000) {
    return `${Math.floor(elapsed / 1_000)}s ago`;
  }
  if (elapsed < 3_600_000) {
    return `${Math.floor(elapsed / 60_000)}m ago`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)}h ago`;
  }
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
