import { useState } from "react";
import { AgentIcon } from "../../components/AgentIcon";
import { parseGroupRef, type GroupRef } from "../../../../shared/groups";
import type {
  GroupTerminalObservation,
  GroupView,
  GroupViewMember,
} from "../../../../shared/groupViews";
import { groupMemberEdit, type GroupEditPlan, memberRef } from "./groupActions";

export function MemberPortrait({
  member,
  reviewer = false,
  harness,
}: {
  member: GroupViewMember;
  reviewer?: boolean;
  harness?(terminal: GroupTerminalObservation): string | undefined;
}) {
  return (
    <span
      className={`group-portrait${reviewer ? " is-reviewer" : ""}${member.resolution === "present" ? "" : " is-away"}`}
      title={`${member.label} · ${reviewer ? "Reviewer" : member.roles.join(", ") || "Member"} · ${member.resolution}`}
    >
      <AgentIcon
        compact
        agent={member.matches[0] && harness?.(member.matches[0])}
      />
    </span>
  );
}

export function GroupMembers({
  group,
  groups,
  terminals,
  busy,
  revision,
  onPlan,
  onError,
  onOpen,
  harness,
}: {
  group: GroupView;
  groups: readonly GroupView[];
  terminals: readonly GroupTerminalObservation[];
  busy: boolean;
  revision: number;
  onPlan(plan: GroupEditPlan): void;
  onError(message: string): void;
  onOpen(terminal: GroupTerminalObservation): void;
  harness(terminal: GroupTerminalObservation): string | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState("");
  const [address, setAddress] = useState("");
  const [role, setRole] = useState("builder");
  const [editing, setEditing] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [roleRevision, setRoleRevision] = useState(revision);
  const sections =
    group.kind === "pod" ? ["lead", "builder", "reviewer", "other"] : ["other"];
  const apply = (action: () => void) => {
    try {
      action();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const eligible = terminals.filter(
    (terminal) =>
      group.kind !== "team" ||
      !group.members.length ||
      (typeof group.members[0]!.ref !== "string" &&
        group.members[0]!.ref.connection_id === terminal.connectionId),
  );
  return (
    <section className="group-members" aria-label="Members">
      <div className="group-section-heading">
        <h3>Members</h3>
        {group.stored && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(!adding)}
          >
            Add…
          </button>
        )}
      </div>
      {adding && (
        <form
          className="group-edit"
          onSubmit={(event) => {
            event.preventDefault();
            apply(() => {
              const terminal = eligible.find(
                (entry) =>
                  `${entry.connectionId}\0${entry.terminalId}` === selected,
              );
              const ref = address.trim()
                ? parseGroupRef(address.trim())
                : terminal
                  ? memberRef(group, terminal)
                  : undefined;
              if (!ref)
                throw new Error("Choose an agent or give a qualified address.");
              const plan = groupMemberEdit(
                group,
                ref,
                group.kind === "team" ? [] : [role],
                groups,
              );
              onPlan(plan);
              setAdding(false);
              setAddress("");
              setSelected("");
            });
          }}
        >
          <label>
            Current agent
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Choose…</option>
              {eligible.map((terminal) => (
                <option
                  key={`${terminal.connectionId}\0${terminal.terminalId}`}
                  value={`${terminal.connectionId}\0${terminal.terminalId}`}
                >
                  {terminal.name ?? terminal.terminalId} ·{" "}
                  {terminal.connectionId} · {terminal.deskId}
                </option>
              ))}
            </select>
          </label>
          {group.kind === "pod" && (
            <>
              <label>
                Or qualified address
                <input
                  value={address}
                  placeholder="agent://connection-a/name"
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>
              <label>
                Role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  {["builder", "lead", "reviewer"].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button disabled={busy}>Add member</button>
          <button type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}
      {group.owner === "herdr" && (
        <p className="group-hint">
          Herdr owns this membership. Move the whole desk into a Room, or a pane
          into a Desk in Town. CLI moves require <code>--herdr</code>.
        </p>
      )}
      {sections.map((section) => {
        const members = group.members.filter((member) =>
          section === "other"
            ? group.kind !== "pod" ||
              !member.roles.some((role) =>
                ["lead", "builder", "reviewer"].includes(role),
              )
            : member.roles.includes(section),
        );
        return members.length ? (
          <div key={section}>
            <h4>
              {section === "other"
                ? "Members"
                : section === "lead"
                  ? "Lead"
                  : section === "builder"
                    ? "Builders"
                    : "Reviewers"}
            </h4>
            {members.map((member) => {
              const key = JSON.stringify(member.ref);
              const ref = member.ref as GroupRef;
              return (
                <div
                  className={`group-member${member.resolution === "away" ? " is-away" : ""}`}
                  key={key}
                >
                  <MemberPortrait
                    member={member}
                    reviewer={section === "reviewer"}
                    harness={harness}
                  />
                  <div className="group-member-name">
                    <b title={member.label}>{member.label}</b>
                    <small>
                      {member.resolution === "ambiguous"
                        ? `${member.matches.length} agents named ${member.label}. Inspect a match; membership remains ambiguous.`
                        : member.resolution === "away"
                          ? "Away · last seen unavailable"
                          : "Present"}
                    </small>
                  </div>
                  {member.matches.map((match) => (
                    <button
                      key={`${match.connectionId}\0${match.paneId}`}
                      type="button"
                      onClick={() => onOpen(match)}
                    >
                      {member.resolution === "ambiguous"
                        ? `Inspect ${match.connectionId} · ${match.paneId}`
                        : "Open"}
                    </button>
                  ))}
                  {group.stored && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onPlan({
                            ops: [
                              { op: "group.leave", id: group.id, refs: [ref] },
                            ],
                            confirmation: member.roles.some((role) =>
                              ["lead", "reviewer"].includes(role),
                            )
                              ? `Remove ${member.label} and their ${member.roles.join(", ")} roles from ${group.name}?`
                              : undefined,
                          })
                        }
                      >
                        Remove from {group.kind}
                      </button>
                      {group.kind === "pod" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(key);
                            setRoles([...member.roles]);
                            setRoleRevision(revision);
                          }}
                        >
                          Roles…
                        </button>
                      )}
                      {editing === key && (
                        <form
                          className="group-role-edit"
                          onSubmit={(event) => {
                            event.preventDefault();
                            apply(() => {
                              onPlan({
                                ...groupMemberEdit(
                                  group,
                                  ref,
                                  roles,
                                  groups,
                                  true,
                                ),
                                revision: roleRevision,
                              });
                              setEditing(null);
                            });
                          }}
                        >
                          {[
                            ...new Set([
                              "lead",
                              "builder",
                              "reviewer",
                              ...member.roles,
                            ]),
                          ].map((role) => (
                            <label key={role}>
                              <input
                                type="checkbox"
                                checked={roles.includes(role)}
                                onChange={(event) =>
                                  setRoles(
                                    event.target.checked
                                      ? [...roles, role]
                                      : roles.filter((value) => value !== role),
                                  )
                                }
                              />
                              {role}
                            </label>
                          ))}
                          <button disabled={busy}>Save roles</button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : null;
      })}
      {!group.members.length && <p className="group-hint">No members yet.</p>}
    </section>
  );
}
