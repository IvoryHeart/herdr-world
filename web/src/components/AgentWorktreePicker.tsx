import {
  ResourceConnectionClientContext,
  connectionClientScopeGeneration,
  connectionClientScopeKey,
  type ConnectionClientScope,
} from "../useConnectionClient";
import { resourcePresentationClient } from "../resourcePresentationClient";
import { useId, useRef, useMemo, useContext, type ReactNode } from "react";
import {
  Activity,
  FileText,
  FolderGit2,
  GitBranch,
  MessageSquare,
} from "lucide-react";
import { AGENT_WORKTREE_SOURCE_LABELS } from "../../../shared/agentWorktree";
import type { AgentWorktreeView } from "../useAgentWorktree";
import { middleEllipsis } from "./middleEllipsis";
import "./AgentWorktreePicker.css";

export function AgentWorktreeLine({ view }: { view: AgentWorktreeView }) {
  const { selected, observation, target } = view;
  const source = selected?.source;
  const Icon =
    source === "foreground_cwd"
      ? Activity
      : source === "session_cwd"
        ? FileText
        : source === "agent_report"
          ? MessageSquare
          : source === "branch_match"
            ? GitBranch
            : FolderGit2;
  const stale = observation?.state === "stale";
  return (
    <span
      className={`agent-worktree-line${stale ? " is-stale" : !target ? " is-ambiguous" : ""}`}
    >
      <span
        title={
          source ? AGENT_WORKTREE_SOURCE_LABELS[source] : "Worktree evidence"
        }
      >
        <Icon size={12} aria-hidden="true" />
      </span>
      <span
        className="agent-worktree-line-text"
        title={selected?.canonicalRoot}
      >
        {selected ? (
          <>
            <span className="agent-worktree-line-name">
              <bdi>
                {selected.canonicalRoot.split("/").filter(Boolean).pop() ??
                  selected.canonicalRoot}
              </bdi>
            </span>
            <span className="agent-worktree-line-branch">
              {" "}
              · {selected.branch ?? "detached HEAD"}
              {stale ? " · stale" : ""}
            </span>
          </>
        ) : observation?.state === "ambiguous" ? (
          `${observation.candidates.length} worktrees · choose`
        ) : view.loading ? (
          "Reading worktree…"
        ) : (
          "Worktree unavailable · choose"
        )}
      </span>
    </span>
  );
}

export function AgentWorktreePicker({ view }: { view: AgentWorktreeView }) {
  const name = useId();
  const stale = view.observation?.state === "stale";
  return (
    <section className="agent-worktree-picker">
      <fieldset>
        <legend>Worktree</legend>
        <p>
          This selects the worktree shown in Files and Changes; it does not
          change the agent&apos;s terminal directory.
        </p>
        {view.observation?.candidates.map((candidate) => (
          <label key={candidate.candidateId} className="agent-worktree-choice">
            <input
              type="radio"
              name={name}
              value={candidate.candidateId}
              aria-label={`${candidate.canonicalRoot} · ${AGENT_WORKTREE_SOURCE_LABELS[candidate.source]}`}
              checked={view.selected?.candidateId === candidate.candidateId}
              disabled={stale || view.observation?.state === "unavailable"}
              onChange={() => view.select(candidate.candidateId)}
            />
            <span>
              <span
                className="agent-worktree-choice-path"
                title={candidate.canonicalRoot}
              >
                {middleEllipsis(candidate.canonicalRoot, 36)}
              </span>
              <small>
                {AGENT_WORKTREE_SOURCE_LABELS[candidate.source]}
                {stale
                  ? " · stale"
                  : view.observation?.state === "ambiguous"
                    ? " · ambiguous"
                    : ""}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      {view.selected ? (
        <p title={view.selected.canonicalRoot}>
          Viewing {middleEllipsis(view.selected.canonicalRoot, 64)}
        </p>
      ) : (
        <p>
          {view.observation?.reason ??
            "Choose a worktree for Files and Changes."}
        </p>
      )}
      {view.observation?.reportedPr ? (
        <a href={view.observation.reportedPr} target="_blank" rel="noreferrer">
          Reported PR
        </a>
      ) : null}
      {view.observation?.unavailableEvidence?.map((evidence) => (
        <p key={`${evidence.source}:${evidence.path}`} title={evidence.path}>
          {AGENT_WORKTREE_SOURCE_LABELS[evidence.source]} ·{" "}
          {middleEllipsis(evidence.path, 56)}: {evidence.reason}
        </p>
      ))}
      {view.observation?.truncated ? (
        <p>
          Showing a bounded set of repository worktrees, with branch matches
          first.
        </p>
      ) : null}
      <button type="button" disabled={view.loading} onClick={view.refresh}>
        {view.loading ? "Refreshing…" : "Refresh"}
      </button>
    </section>
  );
}

export function AgentWorktreeGate({
  view,
  retainPresentation = false,
  onChoose,
  children,
}: {
  view?: AgentWorktreeView;
  onChoose(): void;
  children: ReactNode;
  retainPresentation?: boolean;
}) {
  const client = useContext(ResourceConnectionClientContext);
  const owner = JSON.stringify([
    client?.connectionId,
    client && connectionClientScopeGeneration(client),
    view?.observation?.subject,
  ]);
  const admitted = useRef<{
    owner: string;
    identity: string;
    scope: ConnectionClientScope | null;
  } | null>(null);
  const identity = client ? connectionClientScopeKey(client) : "";
  if (
    (!view || view.target) &&
    (admitted.current?.owner !== owner ||
      admitted.current?.identity !== identity)
  ) {
    admitted.current = {
      owner,
      identity,
      scope: client
        ? {
            connectionId: client.connectionId,
            generation: client.generation,
            serverRuntimeGeneration: client.serverRuntimeGeneration,
            agentWorktree: client.agentWorktree,
          }
        : null,
    };
  }
  const scope =
    admitted.current?.owner === owner ? admitted.current.scope : client;
  const presentationClient = useMemo(
    () =>
      client && scope ? resourcePresentationClient(client, scope) : client,
    [client, scope],
  );
  if (
    !view ||
    view.target ||
    (retainPresentation && admitted.current?.owner === owner)
  )
    return (
      <ResourceConnectionClientContext.Provider value={presentationClient}>
        {children}
      </ResourceConnectionClientContext.Provider>
    );
  return (
    <div className="workspace-inspector-unavailable" role="status">
      <strong>
        {view.observation?.state === "stale"
          ? "Worktree evidence is stale"
          : "Choose a worktree"}
      </strong>
      <span>
        {view.observation?.reason ??
          (view.loading
            ? "Reading the agent's worktree evidence…"
            : "Files and Changes need a current worktree selection.")}
      </span>
      <button type="button" onClick={onChoose}>
        Choose a worktree
      </button>
    </div>
  );
}
