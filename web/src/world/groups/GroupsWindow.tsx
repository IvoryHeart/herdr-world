import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ModalDialogs";
import type {
  GroupTerminalObservation,
  GroupView,
} from "../../../../shared/groupViews";
import type { GroupOp } from "../../../../shared/groupOps";
import type { WorldObject } from "../worldObject";
import { WorldPanel } from "../windows/WorldPanel";
import { worldRuntimeStore } from "../runtimeStore";
import { groupRuntimeObservations } from "../groupObservations";
import { GroupDetail } from "./GroupDetail";
import { MemberPortrait } from "./GroupMembers";
import {
  confirmedGroupOps,
  groupPrText,
  groupStatusText,
  groupTitle,
  WORLD_GROUPS_OPEN_EVENT,
  type GroupEditPlan,
} from "./groupActions";
import { useGroups } from "./useGroups";
import "./groups.css";

const KINDS = ["all", "pod", "team", "room", "desk"];
/** Mounted inside the existing WorldPanels provider by WorldControlPlane. */
export function GroupsWindow(props: {
  world: WorldObject;
  onOpenTerminal(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<string | undefined>();
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const onOpen = (event: Event) => {
      setRequested(
        typeof (event as CustomEvent).detail === "string"
          ? (event as CustomEvent<string>).detail
          : undefined,
      );
      setOpen(true);
      setRequest((value) => value + 1);
    };
    window.addEventListener(WORLD_GROUPS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WORLD_GROUPS_OPEN_EVENT, onOpen);
  }, []);
  return open ? (
    <GroupsBody
      {...props}
      requested={requested}
      request={request}
      onClose={() => setOpen(false)}
    />
  ) : null;
}

function GroupsBody({
  world,
  onOpenTerminal,
  requested,
  request,
  onClose,
}: {
  world: WorldObject;
  onOpenTerminal(id: string): void;
  requested?: string;
  request: number;
  onClose(): void;
}) {
  const {
    groups,
    document,
    boardStore,
    error: boardError,
    observations,
  } = useGroups();
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState(requested);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    plan: GroupEditPlan;
    revision: number;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState("pod");
  const [name, setName] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSelected(requested);
  }, [requested, request]);
  const group = groups.find((group) => group.key === selected);
  const terminals = observations
    .filter((connection) => connection.current)
    .flatMap((connection) =>
      connection.terminals.map((terminal) => ({
        ...terminal,
        connectionId: connection.connectionId,
        generation: connection.generation,
      })),
    );
  const harness = (terminal: GroupTerminalObservation) =>
    world.leaves.find(
      (leaf) =>
        leaf.connectionId === terminal.connectionId &&
        leaf.terminalId === terminal.terminalId,
    )?.pane.agent;
  const write = async (ops: GroupOp[], revision: number) => {
    setError(null);
    setBusy(true);
    const result = await boardStore.patch(ops, revision);
    if (mounted.current) {
      setBusy(false);
      setError(result);
    }
  };
  const plan = (plan: GroupEditPlan) => {
    if (!document || busy) return;
    if (plan.confirmation)
      setPending({ plan, revision: plan.revision ?? document.revision });
    else
      void write(confirmedGroupOps(plan), plan.revision ?? document.revision);
  };
  const inspect = (terminal: GroupTerminalObservation) => {
    const connection = groupRuntimeObservations(
      worldRuntimeStore.get().connections,
    ).find(
      (connection) =>
        connection.connectionId === terminal.connectionId &&
        connection.generation === terminal.generation &&
        connection.current,
    );
    const current = connection?.terminals.find(
      (current) =>
        current.paneId === terminal.paneId &&
        current.terminalId === terminal.terminalId &&
        current.sessionFingerprint === terminal.sessionFingerprint,
    );
    const leaf =
      current &&
      world.leaves.find(
        (leaf) =>
          leaf.connectionId === terminal.connectionId &&
          leaf.generation === terminal.generation &&
          leaf.nativeId === terminal.paneId &&
          leaf.terminalId === terminal.terminalId &&
          leaf.actionable,
      );
    if (leaf) onOpenTerminal(leaf.id);
    else
      setError(
        "This agent changed or is no longer current. Read Groups again.",
      );
  };
  return (
    <WorldPanel
      name="groups"
      label={group ? groupTitle(group) : "Groups"}
      onClose={onClose}
    >
      <div className="groups-window">
        {(error || boardError) && (
          <p role="alert" className="group-error">
            {error || boardError}
          </p>
        )}
        {!document && <p role="status">Loading Groups…</p>}
        {group ? (
          <>
            <button
              type="button"
              className="group-back"
              onClick={() => setSelected(undefined)}
            >
              ← Back to Groups
            </button>
            <GroupDetail
              key={group.key}
              group={group}
              groups={groups}
              terminals={terminals}
              changes={
                document?.relations?.group_changes?.filter(
                  (change) => change.group_id === group.id,
                ) ?? []
              }
              busy={busy}
              revision={document?.revision ?? -1}
              onPlan={plan}
              onError={setError}
              onOpen={inspect}
              harness={harness}
            />
          </>
        ) : (
          <>
            {selected && (
              <p className="group-hint">This Group is no longer present.</p>
            )}
            <div className="groups-toolbar">
              <div className="workspace-agent-layout-control group-kind-control">
                <div role="group" aria-label="Group kind">
                  {KINDS.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={kind === value ? "is-active" : ""}
                      aria-pressed={kind === value}
                      onClick={() => setKind(value)}
                    >
                      {value[0]!.toUpperCase()}
                      {value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                disabled={!document || busy}
                onClick={() => setCreating(!creating)}
              >
                New…
              </button>
            </div>
            {creating && (
              <form
                className="group-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  plan({
                    ops: [
                      {
                        op: "group.create",
                        id: `group-${Array.from(
                          crypto.getRandomValues(new Uint32Array(4)),
                        )
                          .map((value) => value.toString(16).padStart(8, "0"))
                          .join("")}`,
                        name: name.trim(),
                        kind: newKind,
                      },
                    ],
                  });
                  setCreating(false);
                  setName("");
                }}
              >
                <label>
                  Kind
                  <select
                    value={newKind}
                    onChange={(event) => setNewKind(event.target.value)}
                  >
                    <option value="pod">Pod</option>
                    <option value="team">Team</option>
                  </select>
                </label>
                <label>
                  Name
                  <input
                    value={name}
                    required
                    maxLength={240}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <button disabled={busy}>Create {newKind}</button>
                <button type="button" onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </form>
            )}
            <div className="group-roster" role="list" aria-label="Groups">
              {groups
                .filter((group) => kind === "all" || group.kind === kind)
                .map((group: GroupView) => (
                  <div key={group.key} role="listitem">
                    <button
                      type="button"
                      className="group-roster-row"
                      onClick={() => setSelected(group.key)}
                    >
                      <span
                        className={`group-status is-${group.status}`}
                        title={groupStatusText(group)}
                      />
                      <span className="group-roster-title">
                        {groupTitle(group)}
                        {!group.current && <small>Cached · not current</small>}
                      </span>
                      <span className="group-lead" aria-label="Lead">
                        {group.members
                          .filter((member) => member.roles.includes("lead"))
                          .slice(0, 1)
                          .map((member) => (
                            <MemberPortrait
                              key={JSON.stringify(member.ref)}
                              member={member}
                              harness={harness}
                            />
                          ))}
                      </span>
                      <span
                        className="group-stack"
                        aria-label={`${group.members.length} members`}
                      >
                        {group.members.slice(0, 4).map((member) => (
                          <MemberPortrait
                            key={JSON.stringify(member.ref)}
                            member={member}
                            harness={harness}
                          />
                        ))}
                        {group.members.length > 4 && (
                          <small>+{group.members.length - 4}</small>
                        )}
                      </span>
                      <span
                        className="group-stack group-reviewers"
                        aria-label="Reviewers"
                      >
                        {group.members
                          .filter((member) => member.roles.includes("reviewer"))
                          .slice(0, 3)
                          .map((member) => (
                            <MemberPortrait
                              key={JSON.stringify(member.ref)}
                              member={member}
                              reviewer
                              harness={harness}
                            />
                          ))}
                        {group.members.filter((member) =>
                          member.roles.includes("reviewer"),
                        ).length > 3 && (
                          <small>
                            +
                            {group.members.filter((member) =>
                              member.roles.includes("reviewer"),
                            ).length - 3}
                          </small>
                        )}
                      </span>
                      <span
                        className={`group-pr-pill${group.overLimit ? " is-warning" : ""}`}
                      >
                        {groupPrText(group)}
                      </span>
                      <span className="group-now" title={group.now[0]}>
                        {group.now[0] ?? "—"}
                      </span>
                    </button>
                  </div>
                ))}
            </div>
            {!groups.some((group) => kind === "all" || group.kind === kind) && (
              <p className="group-hint">
                No {kind === "all" ? "Groups" : `${kind}s`} yet.
              </p>
            )}
          </>
        )}
        <p className="group-crew-rule">
          Lead/Reviewer edits are for the owner or FirstMate by crew rule. World
          records sender claims; it does not authenticate that role.
        </p>
        <ConfirmDialog
          open={pending !== null}
          title="Confirm Group change"
          message={pending?.plan.confirmation ?? ""}
          confirmLabel="Confirm"
          danger={pending?.plan.ops.some((op) => op.op === "group.delete")}
          onClose={() => setPending(null)}
          onConfirm={() => {
            if (pending) {
              void write(confirmedGroupOps(pending.plan), pending.revision);
              setPending(null);
            }
          }}
        />
      </div>
    </WorldPanel>
  );
}
