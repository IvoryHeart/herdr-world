import type { GroupOp } from "../../../../shared/groupOps";
import {
  agentAddress,
  parseAgentAddress,
  groupRefKey,
  hasExclusivePodRole,
  parseGroupRef,
  type GroupRef,
} from "../../../../shared/groups";
import {
  GROUP_STATUS_LABELS,
  type GroupView,
  type GroupViewMember,
  type GroupTerminalObservation,
} from "../../../../shared/groupViews";

export const WORLD_GROUPS_OPEN_EVENT = "herdr-world:groups-open";
export function openGroups(key?: string) {
  window.dispatchEvent(
    new CustomEvent(WORLD_GROUPS_OPEN_EVENT, { detail: key }),
  );
}
export const groupTitle = (group: Pick<GroupView, "kind" | "name">) =>
  `${group.kind[0]?.toUpperCase()}${group.kind.slice(1)} · ${group.name}`;
export const groupStatusText = (group: GroupView) =>
  Object.entries(group.counts)
    .filter(([, count]) => count > 0)
    .map(
      ([status, count]) =>
        `${count} ${GROUP_STATUS_LABELS[status as keyof typeof GROUP_STATUS_LABELS]}`,
    )
    .join(" · ") || "Status unknown";
export const groupPrText = (group: GroupView) =>
  group.workState === "unknown"
    ? "Open PRs unknown"
    : `${group.openPullRequests.length}${group.openPrLimit === null ? "" : `/${group.openPrLimit}`} open PRs${group.workState === "stale" ? " · cached" : ""}`;
export function memberRef(
  group: GroupView,
  terminal: GroupTerminalObservation,
  terminals: readonly GroupTerminalObservation[],
): GroupRef {
  if (group.owner !== "world")
    throw new Error(
      "Herdr owns Room/Desk membership. Move the desk or pane in Town.",
    );
  if (group.kind === "team")
    return {
      connection_id: terminal.connectionId,
      terminal_id: terminal.terminalId,
    };
  if (!terminal.name)
    throw new Error(
      "This agent has no actual Herdr name. Supply a qualified address.",
    );
  if (
    terminals.filter(
      (entry) =>
        entry.connectionId === terminal.connectionId &&
        entry.name === terminal.name,
    ).length !== 1
  )
    throw new Error(
      "Several current agents have that Herdr name. Please rename the agent or give an explicit agent:// address.",
    );
  return agentAddress(terminal.connectionId, terminal.name);
}
/** Revalidate the selection's captured identity rather than adopting a new occupant. */
export function selectedMemberRef(
  group: GroupView,
  selected: GroupTerminalObservation,
  terminals: readonly GroupTerminalObservation[],
): GroupRef {
  const matches = terminals.filter(
    (terminal) =>
      terminal.connectionId === selected.connectionId &&
      terminal.generation === selected.generation &&
      terminal.terminalId === selected.terminalId &&
      terminal.paneId === selected.paneId &&
      terminal.name === selected.name &&
      (terminal.sessionFingerprint ?? null) ===
        (selected.sessionFingerprint ?? null),
  );
  if (matches.length !== 1)
    throw new Error(
      "This agent changed or is no longer current. Choose it again or give an explicit address.",
    );
  return memberRef(group, selected, terminals);
}
export type GroupEditPlan = {
  ops: GroupOp[];
  confirmation?: string;
  replace?: boolean;
  revision?: number;
  /** Forms keep their draft until the revision-bound write returns successfully. */
  onComplete?(error: string | null): void;
};
export function groupMemberEdit(
  group: GroupView,
  ref: GroupRef,
  roles: string[],
  groups: readonly GroupView[],
  edit = false,
): GroupEditPlan {
  if (!group.stored)
    throw new Error(
      "Herdr owns this membership. Move the desk or pane in Town.",
    );
  const parsed = parseGroupRef(ref);
  if (group.kind === "pod" && typeof parsed !== "string")
    throw new Error("A Pod needs an agent:// address.");
  if (group.kind === "team" && (typeof parsed === "string" || roles.length))
    throw new Error("A Team needs a terminal ref and has no roles.");
  const conflict =
    group.kind === "pod" && hasExclusivePodRole(roles)
      ? groups.find(
          (other) =>
            other.id !== group.id &&
            other.kind === "pod" &&
            other.members.some(
              (member) =>
                groupRefKey(member.ref as GroupRef) === groupRefKey(parsed) &&
                hasExclusivePodRole(member.roles),
            ),
        )
      : undefined;
  const op: GroupOp = edit
    ? { op: "group.set_roles", id: group.id, refs: [parsed], roles }
    : { op: "group.join", id: group.id, refs: [parsed], roles };
  return {
    ops: [op],
    ...(conflict
      ? {
          replace: true,
          confirmation: `${typeof parsed === "string" ? parseAgentAddress(parsed).name : "This agent"} already leads or builds ${conflict.name}. Move that exclusive role here instead? Other roles are kept.`,
        }
      : {}),
  };
}
export function confirmedGroupOps(plan: GroupEditPlan): GroupOp[] {
  return plan.ops.map((op) => ({
    ...op,
    ...((op.op === "group.join" ||
      op.op === "group.set_roles" ||
      op.op === "group.promote") &&
    plan.replace === true
      ? { replace: true }
      : {}),
    sender: { basis: "unknown", via: "browser" },
  }));
}
export function groupPromotion(
  group: GroupView,
  name: string,
  groups: readonly GroupView[],
): GroupEditPlan {
  if (group.kind !== "team" || !group.stored)
    throw new Error("Only a stored Team can be promoted.");
  const mapping = group.members.map((member: GroupViewMember) => {
    const match =
      member.resolution === "present" && member.matches.length === 1
        ? member.matches[0]
        : undefined;
    if (
      !match?.name ||
      typeof member.ref === "string" ||
      "tab_id" in member.ref
    )
      throw new Error(
        "Every Team member needs one current named agent. Use the CLI for an explicit complete address mapping.",
      );
    const to = agentAddress(match.connectionId, match.name);
    if (
      groups.some(
        (pod) =>
          pod.kind === "pod" &&
          pod.members.some(
            (entry) => entry.ref === to && hasExclusivePodRole(entry.roles),
          ),
      )
    )
      throw new Error(
        `${match.name} already leads or builds a Pod; transfer the role explicitly before promotion.`,
      );
    return { from: member.ref, to, roles: ["builder"] };
  });
  return {
    ops: [{ op: "group.promote", id: group.id, name, mapping }],
    confirmation: `Promote to Pod · ${name}, preserving this Group's identity? Explicit member mapping: ${mapping.map((entry) => `${entry.from.terminal_id} → ${entry.to}`).join("; ") || "empty Team"}.`,
  };
}
