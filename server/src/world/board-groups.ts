import {
  checkStoredGroups,
  GROUP_LIMITS,
  groupCount,
  groupObject,
  groupRefKey,
  groupText,
  hasExclusivePodRole,
  parseGroupAttrs,
  parseGroupMember,
  parseGroupRef,
  parseGroupRoles,
  parseGroupSender,
  storedGroupKind,
  type Group,
  type GroupChange,
  type GroupRef,
} from "../../../shared/groups";
import {
  joinGroup,
  leaveGroups,
  type RelationsDocument,
  type TerminalRef,
} from "../../../shared/relations";

import type { GroupOp } from "../../../shared/groupOps";
export type { GroupOp } from "../../../shared/groupOps";

const operations = new Set([
  "group.create",
  "group.join",
  "group.leave",
  "group.set_roles",
  "group.set_attrs",
  "group.delete",
  "group.promote",
]);
export const isGroupOp = (op: { op?: unknown }): boolean =>
  typeof op.op === "string" && operations.has(op.op);

function refs(value: unknown, allowDuplicates = false): GroupRef[] {
  if (!Array.isArray(value) || value.length > GROUP_LIMITS.members)
    throw new Error(
      `members must be a list of at most ${GROUP_LIMITS.members}`,
    );
  const result = value.map(parseGroupRef);
  if (
    !allowDuplicates &&
    new Set(result.map(groupRefKey)).size !== result.length
  )
    throw new Error("duplicate group member");
  return result;
}
function terminals(value: unknown, allowDuplicates = false): TerminalRef[] {
  const result = refs(value, allowDuplicates);
  if (result.some((ref) => typeof ref === "string"))
    throw new Error("teams use terminal refs");
  return result as TerminalRef[];
}
function target(groups: readonly Group[], id: unknown): Group {
  const key = groupText(id, "group id");
  const group = groups.find((group) => group.id === key);
  if (!group) throw new Error(`group ${key} not found`);
  return group;
}
function replaceGroup(groups: readonly Group[], group: Group): Group[] {
  return groups.map((entry) => (entry.id === group.id ? group : entry));
}

/** Pure candidate update; BoardStore validates/saves the whole transaction atomically. */
function apply(groups: readonly Group[], op: GroupOp, now: number): Group[] {
  if (
    "replace" in op &&
    op.replace !== undefined &&
    typeof op.replace !== "boolean"
  )
    throw new Error("invalid confirmed transfer");
  // No generic kind setter: projected membership can never become saved intent.
  if (Object.hasOwn(op, "kind") && op.op !== "group.create") {
    storedGroupKind(Reflect.get(op, "kind"));
    throw new Error("kind changes require explicit Team to Pod promotion");
  }
  switch (op.op) {
    case "group.create": {
      const id = groupText(op.id, "group id");
      if (groups.some((group) => group.id === id))
        throw new Error(`group ${id} already exists`);
      const kind = storedGroupKind(op.kind);
      if (
        op.members !== undefined &&
        (!Array.isArray(op.members) || op.members.length > GROUP_LIMITS.members)
      )
        throw new Error("too many group members");
      return [
        ...groups,
        {
          id,
          kind,
          created_at: now,
          ...(op.name !== undefined
            ? { name: groupText(op.name, "group name") }
            : {}),
          members: (op.members ?? []).map((member) =>
            parseGroupMember(member, now),
          ),
          ...(kind === "pod" || op.attrs !== undefined
            ? {
                attrs: {
                  ...(kind === "pod" ? { open_pr_limit: 2 } : {}),
                  ...parseGroupAttrs(op.attrs === undefined ? {} : op.attrs),
                },
              }
            : {}),
        },
      ];
    }
    case "group.join": {
      if ("target" in op && "refs" in op)
        throw new Error("ambiguous group join");
      if ("target" in op)
        return joinGroup(
          groups,
          terminals(op.members, true),
          terminals(op.target, true),
          groupText(op.id, "group id"),
          now,
        );
      const group = target(groups, op.id);
      const adding = refs(op.refs);
      const roles = parseGroupRoles(op.roles === undefined ? [] : op.roles);
      const members = group.members.map((member) => ({
        ...member,
        roles: [...member.roles],
      }));
      for (const ref of adding) {
        const existing = members.find(
          (member) => groupRefKey(member.ref) === groupRefKey(ref),
        );
        if (existing)
          existing.roles = [...new Set([...existing.roles, ...roles])].sort();
        else members.push({ ref, roles: [...roles], joined_at: now });
      }
      const next = { ...group, members };
      if (group.kind === "team") {
        const left = leaveGroups(
          groups.filter((entry) => entry.id !== group.id),
          terminals(op.refs),
        );
        return [...left, next];
      }
      return replaceGroup(groups, next);
    }
    case "group.leave": {
      if ("members" in op && "refs" in op)
        throw new Error("ambiguous group leave");
      if ("members" in op)
        return leaveGroups(groups, terminals(op.members, true));
      const group = target(groups, op.id);
      const removing = new Set(refs(op.refs).map(groupRefKey));
      const next = {
        ...group,
        members: group.members.filter(
          (member) => !removing.has(groupRefKey(member.ref)),
        ),
      };
      return next.kind === "team" && !next.name && next.members.length < 2
        ? groups.filter((entry) => entry.id !== group.id)
        : replaceGroup(groups, next);
    }
    case "group.set_roles": {
      const group = target(groups, op.id);
      const selected = new Set(refs(op.refs).map(groupRefKey));
      const roles = parseGroupRoles(op.roles);
      if (
        [...selected].some(
          (key) =>
            !group.members.some((member) => groupRefKey(member.ref) === key),
        )
      )
        throw new Error("role target is not a group member");
      return replaceGroup(groups, {
        ...group,
        members: group.members.map((member) =>
          selected.has(groupRefKey(member.ref))
            ? { ...member, roles: [...roles] }
            : member,
        ),
      });
    }
    case "group.set_attrs": {
      const group = target(groups, op.id);
      const next = { ...group };
      if (op.name === null) delete next.name;
      else if (op.name !== undefined)
        next.name = groupText(op.name, "group name");
      if (op.attrs === null) delete next.attrs;
      else if (op.attrs !== undefined)
        next.attrs = parseGroupAttrs({
          ...group.attrs,
          ...parseGroupAttrs(op.attrs),
        });
      return replaceGroup(groups, next);
    }
    case "group.delete": {
      const group = target(groups, op.id);
      return groups.filter((entry) => entry.id !== group.id);
    }
    case "group.promote": {
      const group = target(groups, op.id);
      if (group.kind !== "team")
        throw new Error(
          "only a Team can be promoted to a Pod; Herdr projections are never stored",
        );
      if (
        !Array.isArray(op.mapping) ||
        op.mapping.length !== group.members.length
      )
        throw new Error("promotion needs a complete explicit address mapping");
      const from = new Set<string>();
      const to = new Set<string>();
      const members = op.mapping.map((mapping) => {
        if (!groupObject(mapping)) throw new Error("invalid promotion mapping");
        const ref = parseGroupRef(mapping.from);
        if (typeof ref === "string")
          throw new Error("promotion maps terminal refs to addresses");
        const key = groupRefKey(ref);
        const old = group.members.find(
          (member) => groupRefKey(member.ref) === key,
        );
        if (!old || from.has(key))
          throw new Error("promotion mapping is missing or ambiguous");
        from.add(key);
        const address = parseGroupRef(mapping.to);
        if (typeof address !== "string" || to.has(address))
          throw new Error("promotion mapping is missing or ambiguous");
        to.add(address);
        return {
          ...old,
          ref: address,
          roles: parseGroupRoles(
            mapping.roles === undefined ? [] : mapping.roles,
          ),
        };
      });
      return replaceGroup(groups, {
        ...group,
        kind: "pod",
        name: groupText(op.name, "pod name"),
        members,
        attrs: { open_pr_limit: 2, ...group.attrs },
      });
    }
  }
}

/** Explicitly confirmed transfer clears only pooled exclusive roles in other pods. */
function transfer(groups: Group[], op: GroupOp): Group[] {
  if (!("replace" in op) || op.replace !== true) return groups;
  const group = target(groups, op.id);
  if (group.kind !== "pod") return groups;
  const moving = new Set(
    group.members
      .filter((member) => hasExclusivePodRole(member.roles))
      .map((member) => groupRefKey(member.ref)),
  );
  return groups.map((entry) =>
    entry.id === group.id || entry.kind !== "pod"
      ? entry
      : {
          ...entry,
          members: entry.members.map((member) =>
            moving.has(groupRefKey(member.ref))
              ? {
                  ...member,
                  roles: member.roles.filter(
                    (role) => role !== "lead" && role !== "builder",
                  ),
                }
              : member,
          ),
        },
  );
}

/** Keep complete before/after member diffs, then retain the latest 128 events. */
export function recordGroupChanges(
  relations: RelationsDocument,
  before: readonly Group[],
  op: string,
  sender: unknown,
  now: number,
  revision: number,
): void {
  const claim = parseGroupSender(sender);
  const old = new Map(before.map((group) => [group.id, group]));
  const next = new Map(relations.groups.map((group) => [group.id, group]));
  const events: GroupChange[] = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id),
      b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const from = new Map(
      (a?.members ?? []).map((member) => [groupRefKey(member.ref), member]),
    );
    const to = new Map(
      (b?.members ?? []).map((member) => [groupRefKey(member.ref), member]),
    );
    const members: GroupChange["members"] = [];
    for (const key of new Set([...from.keys(), ...to.keys()])) {
      const first = from.get(key),
        last = to.get(key);
      if (JSON.stringify(first?.roles) === JSON.stringify(last?.roles))
        continue;
      members.push({
        ref: (last ?? first)!.ref,
        ...(first ? { before: first.roles } : {}),
        ...(last ? { after: last.roles } : {}),
      });
    }
    if (members.length > GROUP_LIMITS.memberChanges)
      throw new Error("group member change exceeds its before/after bounds");
    events.push({
      group_id: id,
      revision: groupCount(revision, "event revision"),
      at: now,
      op,
      sender: claim,
      members,
    });
  }
  relations.group_changes = [
    ...(relations.group_changes ?? []),
    ...events,
  ].slice(-GROUP_LIMITS.changes);
}

export function applyGroupOp(
  relations: RelationsDocument,
  op: GroupOp,
  now: number,
  revision: number,
): void {
  const before = relations.groups;
  const candidate = transfer(apply(before, op, now), op);
  checkStoredGroups(candidate);
  relations.groups = candidate;
  recordGroupChanges(relations, before, op.op, op.sender, now, revision);
}
