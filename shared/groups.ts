import type { TerminalRef } from "./relations";

/** Stored groups belong to World. Room/Desk are projected from Herdr elsewhere. */
export type GroupRef = TerminalRef | string;
export type GroupMember = {
  ref: GroupRef;
  roles: string[];
  joined_at: number;
  name_at_join?: string;
};
export type GroupMemberInput = Omit<GroupMember, "joined_at">;
export type GroupAttr = string | number | boolean | null | string[];
export type GroupAttrs = {
  open_pr_limit?: number;
  queue?: string[];
  [key: string]: GroupAttr | undefined;
};
export type Group = {
  id: string;
  kind: string;
  name?: string;
  members: GroupMember[];
  attrs?: GroupAttrs;
  created_at: number;
};
export type GroupSender = (
  | { basis: "unknown"; label?: never }
  | { basis: "reported" | "inferred"; label: string }
) & { via?: string };
export type GroupMemberChange = {
  ref: GroupRef;
  /** Absence means the ref was not a member on that side of the edit. */
  before?: string[];
  after?: string[];
};
export type GroupChange = {
  group_id: string;
  revision: number;
  at: number;
  op: string;
  sender: GroupSender;
  members: GroupMemberChange[];
};

export const GROUP_LIMITS = Object.freeze({
  groups: 500,
  members: 32,
  podsPerConnection: 32,
  changes: 128,
  memberChanges: 64,
  key: 240,
  address: 1500,
  roles: 16,
  role: 64,
  attributes: 16,
  text: 1000,
  items: 32,
});

export function groupObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function groupText(
  value: unknown,
  what: string,
  max: number = GROUP_LIMITS.key,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /\p{Cc}/u.test(value)
  )
    throw new Error(`invalid ${what}`);
  return value;
}
export function groupCount(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`invalid ${what}`);
  return value as number;
}
export function agentAddress(connection: string, name: string): string {
  return groupText(
    `agent://${encodeURIComponent(groupText(connection, "agent connection"))}/${encodeURIComponent(groupText(name, "agent name"))}`,
    "agent address",
    GROUP_LIMITS.address,
  );
}
export function parseAgentAddress(value: string): {
  connection_id: string;
  name: string;
} {
  groupText(value, "agent address", GROUP_LIMITS.address);
  const match = /^agent:\/\/([^/?#]+)\/([^/?#]+)$/.exec(value);
  if (!match) throw new Error("invalid agent address");
  try {
    return {
      connection_id: groupText(
        decodeURIComponent(match[1]!),
        "agent connection",
      ),
      name: groupText(decodeURIComponent(match[2]!), "agent name"),
    };
  } catch {
    throw new Error("invalid agent address");
  }
}
export function parseGroupRef(value: unknown): GroupRef {
  if (typeof value === "string") {
    const address = parseAgentAddress(value);
    return agentAddress(address.connection_id, address.name);
  }
  if (!groupObject(value)) throw new Error("invalid group member ref");
  return {
    connection_id: groupText(value.connection_id, "terminal connection"),
    terminal_id: groupText(value.terminal_id, "terminal ID"),
  };
}
export function groupRefKey(ref: GroupRef): string {
  return typeof ref === "string"
    ? `address:${ref}`
    : `terminal:${ref.connection_id}\0${ref.terminal_id}`;
}
export function groupRefConnection(ref: GroupRef): string {
  return typeof ref === "string"
    ? parseAgentAddress(ref).connection_id
    : ref.connection_id;
}
/** Only Teams feed magnetic layout, spawn relations and terminal pruning. */
export function teamMembers(group: Group): TerminalRef[] {
  return group.kind === "team"
    ? group.members.flatMap(({ ref }) => (typeof ref === "string" ? [] : [ref]))
    : [];
}
export function parseGroupRoles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > GROUP_LIMITS.roles)
    throw new Error("invalid group roles");
  const roles = value.map((role) =>
    groupText(role, "group role", GROUP_LIMITS.role),
  );
  if (new Set(roles).size !== roles.length)
    throw new Error("duplicate group roles");
  return roles.sort();
}
export function parseGroupAttrs(value: unknown): GroupAttrs {
  if (
    !groupObject(value) ||
    Object.keys(value).length > GROUP_LIMITS.attributes
  )
    throw new Error("invalid group attributes");
  const result: GroupAttrs = {};
  for (const [key, entry] of Object.entries(value)) {
    groupText(key, "group attribute", GROUP_LIMITS.role);
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      throw new Error("invalid group attribute");
    if (Array.isArray(entry)) {
      if (entry.length > GROUP_LIMITS.items)
        throw new Error("too many group attribute items");
      result[key] = entry.map((item) =>
        groupText(item, "group attribute item", GROUP_LIMITS.text),
      );
    } else if (typeof entry === "string") {
      result[key] = groupText(entry, "group attribute", GROUP_LIMITS.text);
    } else if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    ) {
      result[key] = entry;
    } else throw new Error("invalid group attribute value");
  }
  if (result.open_pr_limit !== undefined)
    groupCount(result.open_pr_limit, "open PR limit");
  if (result.queue !== undefined && !Array.isArray(result.queue))
    throw new Error("invalid Now list");
  return result;
}
export function storedGroupKind(value: unknown): string {
  const kind = groupText(value, "group kind", GROUP_LIMITS.role)
    .trim()
    .toLowerCase();
  if (kind === "room" || kind === "desk")
    throw new Error(
      "Rooms and desks belong to Herdr; they cannot be stored as World groups",
    );
  return kind;
}
export function parseGroupMember(
  value: unknown,
  joinedAt?: number,
): GroupMember {
  if (!groupObject(value)) throw new Error("invalid group member");
  return {
    ref: parseGroupRef(value.ref),
    roles: parseGroupRoles(value.roles === undefined ? [] : value.roles),
    joined_at: joinedAt ?? groupCount(value.joined_at, "member join time"),
    ...(value.name_at_join !== undefined
      ? { name_at_join: groupText(value.name_at_join, "member name") }
      : {}),
  };
}
/** The old terminal array migrates once on read; the next write saves the new shape. */
export function parseStoredGroup(value: unknown): Group {
  if (!groupObject(value)) throw new Error("invalid group");
  const created_at = groupCount(value.created_at, "group time");
  const legacy = value.kind === undefined;
  if (
    !Array.isArray(value.members) ||
    value.members.length > GROUP_LIMITS.members
  )
    throw new Error("too many group members");
  return {
    id: groupText(value.id, "group id"),
    kind: legacy ? "team" : storedGroupKind(value.kind),
    ...(value.name !== undefined
      ? { name: groupText(value.name, "group name") }
      : {}),
    members: value.members.map((entry) =>
      legacy
        ? { ref: parseGroupRef(entry), roles: [], joined_at: created_at }
        : parseGroupMember(entry),
    ),
    ...(value.attrs !== undefined
      ? { attrs: parseGroupAttrs(value.attrs) }
      : {}),
    created_at,
  };
}
export function parseGroupSender(value: unknown): GroupSender {
  if (value === undefined) return { basis: "unknown" };
  if (!groupObject(value)) throw new Error("invalid group sender");
  const via =
    value.via === undefined
      ? {}
      : { via: groupText(value.via, "sender channel", GROUP_LIMITS.role) };
  if (value.basis === "unknown" && value.label === undefined)
    return { basis: "unknown", ...via };
  if (value.basis !== "reported" && value.basis !== "inferred")
    throw new Error("invalid sender claim basis");
  return {
    basis: value.basis,
    label: groupText(value.label, "sender label", GROUP_LIMITS.text),
    ...via,
  };
}
export function parseGroupChanges(value: unknown): GroupChange[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > GROUP_LIMITS.changes)
    throw new Error("too many group change events");
  return value.map((entry) => {
    if (
      !groupObject(entry) ||
      !Array.isArray(entry.members) ||
      entry.members.length > GROUP_LIMITS.memberChanges
    )
      throw new Error("invalid group change event");
    return {
      group_id: groupText(entry.group_id, "event group"),
      revision: groupCount(entry.revision, "event revision"),
      at: groupCount(entry.at, "event time"),
      op: groupText(entry.op, "group operation", GROUP_LIMITS.role),
      sender: parseGroupSender(entry.sender),
      members: entry.members.map((change) => {
        if (!groupObject(change)) throw new Error("invalid member change");
        return {
          ref: parseGroupRef(change.ref),
          ...(change.before !== undefined
            ? { before: parseGroupRoles(change.before) }
            : {}),
          ...(change.after !== undefined
            ? { after: parseGroupRoles(change.after) }
            : {}),
        };
      }),
    };
  });
}

export const hasExclusivePodRole = (roles: readonly string[]) =>
  roles.some((role) => role === "lead" || role === "builder");

/** Apply this to the whole candidate, so failed operations never save partial transfers. */
export function checkStoredGroups(groups: readonly Group[]): void {
  if (groups.length > GROUP_LIMITS.groups)
    throw new Error(`at most ${GROUP_LIMITS.groups} groups`);
  const ids = new Set<string>();
  const exclusive = new Set<string>();
  const pods = new Map<string, number>();
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error("duplicate group ids");
    ids.add(group.id);
    storedGroupKind(group.kind);
    if (group.kind === "pod" && !group.name)
      throw new Error("a pod needs a name");
    if (group.members.length > GROUP_LIMITS.members)
      throw new Error(`a group holds at most ${GROUP_LIMITS.members} members`);
    if (group.kind === "team" && !group.name && group.members.length < 2)
      throw new Error("an unnamed team has at least two members");
    const seen = new Set<string>();
    const connections = new Set<string>();
    for (const member of group.members) {
      parseGroupRoles(member.roles);
      groupCount(member.joined_at, "member join time");
      const key = groupRefKey(member.ref);
      if (seen.has(key)) throw new Error("duplicate group member");
      seen.add(key);
      connections.add(groupRefConnection(member.ref));
      if (
        group.kind === "team" &&
        (typeof member.ref === "string" || member.roles.length)
      )
        throw new Error("teams use terminal refs without roles");
      if (group.kind === "pod" && typeof member.ref !== "string")
        throw new Error("pods use agent address refs");
      if (
        group.kind === "team" ||
        (group.kind === "pod" && hasExclusivePodRole(member.roles))
      ) {
        const claim = `${group.kind}\0${key}`;
        if (exclusive.has(claim))
          throw new Error(
            group.kind === "team"
              ? "a terminal is in one team at a time"
              : "lead and builder roles belong to one pod; confirm an explicit transfer",
          );
        exclusive.add(claim);
      }
    }
    if (group.kind === "team" && connections.size > 1)
      throw new Error("a team cannot span connections");
    if (group.kind === "pod")
      for (const connection of connections) {
        const count = (pods.get(connection) ?? 0) + 1;
        if (count > GROUP_LIMITS.podsPerConnection)
          throw new Error(
            `at most ${GROUP_LIMITS.podsPerConnection} pods per connection`,
          );
        pods.set(connection, count);
      }
  }
}

/** Observation only: an unresolved address never selects a different occupant. */
export function resolveGroupRef(
  ref: GroupRef,
  agents: readonly {
    connection_id: string;
    terminal_id: string;
    name: string;
    current: boolean;
  }[],
):
  | { state: "away" }
  | { state: "ambiguous"; matches: TerminalRef[] }
  | { state: "present"; terminal: TerminalRef } {
  const address = typeof ref === "string" ? parseAgentAddress(ref) : null;
  const matches = new Map<string, TerminalRef>();
  for (const agent of agents) {
    if (
      !agent.current ||
      agent.connection_id !==
        (address?.connection_id ?? (ref as TerminalRef).connection_id)
    )
      continue;
    if (
      address
        ? agent.name !== address.name
        : agent.terminal_id !== (ref as TerminalRef).terminal_id
    )
      continue;
    const terminal = {
      connection_id: agent.connection_id,
      terminal_id: agent.terminal_id,
    };
    matches.set(groupRefKey(terminal), terminal);
  }
  const terminals = [...matches.values()];
  return terminals.length === 0
    ? { state: "away" }
    : terminals.length > 1
      ? { state: "ambiguous", matches: terminals }
      : { state: "present", terminal: terminals[0]! };
}
