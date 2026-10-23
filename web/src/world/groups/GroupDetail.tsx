import { useState } from "react";
import {
  GROUP_STATUS_LABELS,
  type GroupTerminalObservation,
  type GroupView,
} from "../../../../shared/groupViews";
import type { GroupChange } from "../../../../shared/groups";
import { PullRequestCard } from "../PullRequestCard";
import { GroupMembers } from "./GroupMembers";
import { GroupInterestButton } from "./GroupInterestButton";
import {
  groupPromotion,
  groupPrText,
  groupStatusText,
  groupTitle,
  type GroupEditPlan,
} from "./groupActions";

export function GroupDetail({
  group,
  groups,
  terminals,
  changes,
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
  changes: readonly GroupChange[];
  busy: boolean;
  revision: number;
  onPlan(plan: GroupEditPlan): void;
  onError(message: string): void;
  onOpen(terminal: GroupTerminalObservation): void;
  harness(terminal: GroupTerminalObservation): string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [editRevision, setEditRevision] = useState(revision);
  const [name, setName] = useState(group.name);
  const [now, setNow] = useState(group.now.join("\n"));
  const [limit, setLimit] = useState(String(group.openPrLimit ?? 2));
  return (
    <div className="group-detail">
      <GroupInterestButton group={group} onError={onError} />
      <p className="group-status-line">
        <span
          className={`group-status is-${group.status}`}
          aria-label={GROUP_STATUS_LABELS[group.status]}
        />
        {groupStatusText(group)}
        {!group.current && " · cached topology"}
      </p>
      <GroupMembers
        group={group}
        groups={groups}
        terminals={terminals}
        busy={busy}
        revision={revision}
        onPlan={onPlan}
        onError={onError}
        onOpen={onOpen}
        harness={harness}
      />
      <section>
        <div className="group-section-heading">
          <h3>Open PRs</h3>
          <span
            className={`group-pr-pill${group.overLimit ? " is-warning" : ""}`}
          >
            {groupPrText(group)}
          </span>
        </div>
        {group.workState !== "current" && (
          <p className="group-hint">
            {group.workState === "stale"
              ? "Cached work · GitHub refresh failed. Check the current head before acting."
              : "GitHub work is unavailable; the count is unknown."}
          </p>
        )}
        {group.openPullRequests.map((item) => (
          <PullRequestCard key={item.key} item={item} compact />
        ))}
        {group.workState === "current" && !group.openPullRequests.length && (
          <p className="group-hint">No linked open PRs.</p>
        )}
      </section>
      <section>
        <h3>Now</h3>
        {group.now.length ? (
          <ol>
            {group.now.map((item, index) => (
              <li key={`${index}:${item}`}>
                {/^https:\/\//.test(item) ? (
                  <a href={item} target="_blank" rel="noreferrer">
                    {item}
                  </a>
                ) : (
                  item
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="group-hint">No Now items.</p>
        )}
      </section>
      {group.stored && (
        <>
          <div className="group-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setName(group.name);
                setNow(group.now.join("\n"));
                setLimit(String(group.openPrLimit ?? 2));
                setEditing(!editing);
                setEditRevision(revision);
              }}
            >
              Edit {group.kind}…
            </button>
            {group.kind === "team" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  try {
                    onPlan(groupPromotion(group, name || group.name, groups));
                  } catch (error) {
                    onError(
                      error instanceof Error ? error.message : String(error),
                    );
                  }
                }}
              >
                Promote to Pod…
              </button>
            )}
            <button
              type="button"
              className="is-danger"
              disabled={busy}
              onClick={() =>
                onPlan({
                  ops: [{ op: "group.delete", id: group.id }],
                  confirmation: `Delete ${groupTitle(group)}? Its agents keep running and recent deletion attribution is retained.`,
                })
              }
            >
              Delete {group.kind}…
            </button>
          </div>
          {editing && (
            <form
              className="group-edit"
              onSubmit={(event) => {
                event.preventDefault();
                const numeric = Number(limit);
                if (!Number.isSafeInteger(numeric) || numeric < 0) {
                  onError("Open-PR limit must be a nonnegative integer.");
                  return;
                }
                onPlan({
                  revision: editRevision,
                  ops: [
                    {
                      op: "group.set_attrs",
                      id: group.id,
                      name: name.trim(),
                      attrs: {
                        queue: now
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                        ...(group.kind === "pod"
                          ? { open_pr_limit: numeric }
                          : {}),
                      },
                    },
                  ],
                });
                setEditing(false);
              }}
            >
              <label>
                Name
                <input
                  value={name}
                  maxLength={240}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Now · one item per line
                <textarea
                  value={now}
                  onChange={(event) => setNow(event.target.value)}
                />
              </label>
              {group.kind === "pod" && (
                <label>
                  Open-PR limit · warning only
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                  />
                </label>
              )}
              <button disabled={busy}>Save</button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          )}
        </>
      )}
      <section className="group-attribution">
        <h3>Recent changes</h3>
        <p className="group-hint">
          Latest 128 changes across all Groups · sender claims, not
          authenticated identities.
        </p>
        {changes.length ? (
          changes
            .slice(-12)
            .reverse()
            .map((change, index) => (
              <p key={`${change.revision}:${change.group_id}:${index}`}>
                {change.op.replace("group.", "").replace(/_/g, " ")} by{" "}
                {change.sender.basis === "unknown"
                  ? "unknown sender"
                  : `${change.sender.label} (${change.sender.basis})`}{" "}
                ·{" "}
                <time dateTime={new Date(change.at).toISOString()}>
                  {new Date(change.at).toLocaleTimeString()}
                </time>
              </p>
            ))
        ) : (
          <p className="group-hint">No recent attribution retained.</p>
        )}
      </section>
    </div>
  );
}
