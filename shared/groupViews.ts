import {
  agentAddress,
  groupRefKey,
  parseAgentAddress,
  type Group,
  type GroupRef,
} from "./groups";
import type { WorkItem, WorkLink } from "./worldSources";

/** Projected refs are display data; they never widen stored GroupRef. */
export type GroupDeskRef = { connection_id: string; tab_id: string };
export type GroupViewRef = GroupRef | GroupDeskRef;
export type GroupStatus =
  | "needs_you"
  | "failed"
  | "working"
  | "finished"
  | "quiet"
  | "unknown";
export const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  needs_you: "needs you",
  failed: "failed",
  working: "working",
  finished: "finished",
  quiet: "quiet",
  unknown: "unknown",
};
const STATUS_ORDER = Object.keys(GROUP_STATUS_LABELS) as GroupStatus[];

/** Normalized observations, never runtime leases or authorization. */
export type GroupConnectionObservation = {
  connectionId: string;
  generation: number;
  current: boolean;
  rooms: { id: string; label: string }[];
  desks: { id: string; roomId: string; label: string }[];
  terminals: {
    terminalId: string;
    paneId: string;
    roomId: string;
    deskId: string;
    name?: string;
    status: string;
    sessionFingerprint?: string | null;
  }[];
};
export type GroupTerminalObservation =
  GroupConnectionObservation["terminals"][number] & {
    connectionId: string;
    generation: number;
  };
export type GroupViewMember = {
  ref: GroupViewRef;
  roles: readonly string[];
  label: string;
  resolution: "present" | "away" | "ambiguous";
  /** Ambiguous matches are displayed for explicit inspection, never chosen. */
  matches: readonly GroupTerminalObservation[];
};
export type GroupView = {
  /** Namespaces stored and projected IDs even when their strings coincide. */
  key: string;
  id: string;
  kind: string;
  name: string;
  owner: "world" | "herdr";
  current: boolean;
  stored?: Group;
  projected?: { connectionId: string; nativeId: string };
  members: readonly GroupViewMember[];
  /** Present, unambiguous terminals only, deduplicated across member refs. */
  terminals: readonly GroupTerminalObservation[];
  counts: Record<GroupStatus, number>;
  status: GroupStatus;
  openPullRequests: readonly WorkItem[];
  openPrLimit: number | null;
  overLimit: boolean;
  now: readonly string[];
};

export function projectedGroupId(
  kind: "room" | "desk",
  connectionId: string,
  nativeId: string,
): string {
  return `${kind}:${encodeURIComponent(connectionId)}/${encodeURIComponent(nativeId)}`;
}

function displayStatus(value: string): GroupStatus {
  if (value === "blocked" || value === "needs you" || value === "needs_you")
    return "needs_you";
  if (value === "failed" || value === "error") return "failed";
  if (value === "working") return "working";
  if (value === "done" || value === "finished") return "finished";
  if (value === "idle" || value === "quiet") return "quiet";
  return "unknown";
}
const terminalKey = (terminal: GroupTerminalObservation) =>
  groupRefKey({
    connection_id: terminal.connectionId,
    terminal_id: terminal.terminalId,
  });
const seatKey = (
  value: Pick<
    WorkLink,
    "connectionId" | "generation" | "paneId" | "sessionFingerprint"
  >,
) =>
  JSON.stringify([
    value.connectionId,
    value.generation,
    value.paneId,
    value.sessionFingerprint,
  ]);

/** Derived only: membership, topology and source records remain their owners'. */
export function buildGroupViews(
  stored: readonly Group[],
  connections: readonly GroupConnectionObservation[],
  sources: { items: readonly WorkItem[]; links: readonly WorkLink[] } = {
    items: [],
    links: [],
  },
): GroupView[] {
  const live = new Map<string, GroupTerminalObservation>();
  for (const connection of connections) {
    if (!connection.current) continue;
    for (const terminal of connection.terminals) {
      const observed = {
        ...terminal,
        connectionId: connection.connectionId,
        generation: connection.generation,
      };
      live.set(terminalKey(observed), observed);
    }
  }
  const terminals = [...live.values()];
  const addresses = new Map<string, GroupTerminalObservation[]>();
  const deskKey = (connectionId: string, deskId: string) =>
    JSON.stringify([connectionId, deskId]);
  const deskTerminals = new Map<string, GroupTerminalObservation[]>();
  const desks = new Map(
    connections.flatMap((connection) =>
      connection.desks.map(
        (desk) =>
          [
            deskKey(connection.connectionId, desk.id),
            { ...desk, current: connection.current },
          ] as const,
      ),
    ),
  );
  for (const terminal of terminals) {
    const key = deskKey(terminal.connectionId, terminal.deskId);
    const members = deskTerminals.get(key) ?? [];
    members.push(terminal);
    deskTerminals.set(key, members);
    if (!terminal.name) continue;
    let address: string;
    try {
      address = agentAddress(terminal.connectionId, terminal.name);
    } catch {
      continue;
    } // Invalid runtime names cannot resolve a stored address.
    const matches = addresses.get(address) ?? [];
    matches.push(terminal);
    addresses.set(address, matches);
  }
  const seats = new Map(
    terminals.map((terminal) => [
      seatKey({
        ...terminal,
        sessionFingerprint: terminal.sessionFingerprint ?? null,
      }),
      terminalKey(terminal),
    ]),
  );
  const open = sources.items.filter(
    (item) =>
      item.kind === "pull_request" &&
      item.lane !== "merged" &&
      item.status.toLowerCase() !== "closed",
  );
  const openKeys = new Set(open.map((item) => item.key));
  const work = new Map<string, Set<string>>();
  for (const link of sources.links) {
    const terminal = seats.get(seatKey(link));
    if (!terminal || !openKeys.has(link.itemKey)) continue;
    const items = work.get(terminal) ?? new Set<string>();
    items.add(link.itemKey);
    work.set(terminal, items);
  }

  function member(
    ref: GroupViewRef,
    roles: readonly string[],
    label?: string,
  ): GroupViewMember {
    if (typeof ref !== "string" && "tab_id" in ref) {
      const key = deskKey(ref.connection_id, ref.tab_id);
      const desk = desks.get(key);
      const present = Boolean(desk?.current);
      return {
        ref,
        roles,
        label: desk?.label || ref.tab_id,
        resolution: present ? "present" : "away",
        matches: present ? (deskTerminals.get(key) ?? []) : [],
      };
    }
    const terminal =
      typeof ref === "string" ? undefined : live.get(groupRefKey(ref));
    const matches =
      typeof ref === "string"
        ? (addresses.get(ref) ?? [])
        : terminal
          ? [terminal]
          : [];
    return {
      ref,
      roles,
      matches,
      resolution:
        matches.length === 0
          ? "away"
          : matches.length > 1
            ? "ambiguous"
            : "present",
      label:
        matches[0]?.name ||
        label ||
        (typeof ref === "string"
          ? parseAgentAddress(ref).name
          : ref.terminal_id),
    };
  }

  function view(
    base: Pick<
      GroupView,
      | "key"
      | "id"
      | "kind"
      | "name"
      | "owner"
      | "current"
      | "stored"
      | "projected"
    >,
    members: GroupViewMember[],
  ): GroupView {
    const resolved = new Map<string, GroupTerminalObservation>();
    for (const member of members) {
      if (member.resolution !== "present") continue;
      for (const terminal of member.matches)
        resolved.set(terminalKey(terminal), terminal);
    }
    const counts: Record<GroupStatus, number> = {
      needs_you: 0,
      failed: 0,
      working: 0,
      finished: 0,
      quiet: 0,
      unknown: 0,
    };
    const itemKeys = new Set<string>();
    for (const [key, terminal] of resolved) {
      counts[displayStatus(terminal.status)] += 1;
      for (const itemKey of work.get(key) ?? []) itemKeys.add(itemKey);
    }
    const openPullRequests = [
      ...new Map(
        open
          .filter((item) => itemKeys.has(item.key))
          .map((item) => [item.key, item]),
      ).values(),
    ];
    const openPrLimit =
      base.stored?.attrs?.open_pr_limit ?? (base.kind === "pod" ? 2 : null);
    return {
      ...base,
      members,
      terminals: [...resolved.values()],
      counts,
      status: STATUS_ORDER.find((status) => counts[status] > 0) ?? "unknown",
      openPullRequests,
      openPrLimit,
      overLimit: openPrLimit !== null && openPullRequests.length > openPrLimit,
      now: base.stored?.attrs?.queue ?? [],
    };
  }

  const result = stored.map((group) =>
    view(
      {
        key: `world:${encodeURIComponent(group.id)}`,
        id: group.id,
        kind: group.kind,
        name: group.name || `${group.members.length} members`,
        owner: "world",
        current: true,
        stored: group,
      },
      group.members.map((entry) =>
        member(entry.ref, entry.roles, entry.name_at_join),
      ),
    ),
  );
  for (const connection of connections) {
    const desksByRoom = new Map<string, GroupConnectionObservation["desks"]>();
    for (const desk of connection.desks) {
      const members = desksByRoom.get(desk.roomId) ?? [];
      members.push(desk);
      desksByRoom.set(desk.roomId, members);
    }
    const terminalsByDesk = new Map<
      string,
      GroupConnectionObservation["terminals"]
    >();
    for (const terminal of connection.terminals) {
      const members = terminalsByDesk.get(terminal.deskId) ?? [];
      members.push(terminal);
      terminalsByDesk.set(terminal.deskId, members);
    }
    for (const room of connection.rooms) {
      const id = projectedGroupId("room", connection.connectionId, room.id);
      result.push(
        view(
          {
            key: `herdr:${id}`,
            id,
            kind: "room",
            name: room.label || room.id,
            owner: "herdr",
            current: connection.current,
            projected: {
              connectionId: connection.connectionId,
              nativeId: room.id,
            },
          },
          (desksByRoom.get(room.id) ?? []).map((desk) =>
            member(
              {
                connection_id: connection.connectionId,
                tab_id: desk.id,
              },
              [],
            ),
          ),
        ),
      );
    }
    for (const desk of connection.desks) {
      const id = projectedGroupId("desk", connection.connectionId, desk.id);
      result.push(
        view(
          {
            key: `herdr:${id}`,
            id,
            kind: "desk",
            name: desk.label || desk.id,
            owner: "herdr",
            current: connection.current,
            projected: {
              connectionId: connection.connectionId,
              nativeId: desk.id,
            },
          },
          (terminalsByDesk.get(desk.id) ?? []).map((terminal) =>
            member(
              {
                connection_id: connection.connectionId,
                terminal_id: terminal.terminalId,
              },
              [],
            ),
          ),
        ),
      );
    }
  }
  return result;
}
