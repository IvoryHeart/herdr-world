import { AGENT_WORKTREE_SOURCE_LABELS } from "../../../shared/agentWorktree";
import type { ReactNode } from "react";
import { useLayoutPreferences } from "../layoutPreferences";
import { WorkspaceInspectorLocationSheet } from "./WorkspaceInspectorLocationSheet";
import { ChevronDown } from "lucide-react";
import type { ConnectionClient } from "../api";
import { connectionClientScopeKey } from "../useConnectionClient";
import type { Workspace } from "../types";
import type { AgentWorktreeView } from "../useAgentWorktree";
import { AgentWorktreeLine, AgentWorktreePicker } from "./AgentWorktreePicker";
import { PullRequestCard } from "./PullRequestCard";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function WorkspaceInspectorLocation({
  enabled,
  workspace,
  client,
  content,
  description,
  worktree,
  open,
  onOpenChange,
}: {
  enabled: boolean;
  workspace?: Workspace;
  client: ConnectionClient;
  content: ReactNode;
  description: string;
  worktree?: AgentWorktreeView;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { mobile } = useLayoutPreferences();
  const worktreeDescription = worktree?.selected
    ? `Viewing ${worktree.selected.canonicalRoot}, ${worktree.selected.branch ?? "detached HEAD"}. ${AGENT_WORKTREE_SOURCE_LABELS[worktree.selected.source]}${worktree.observation?.state === "stale" ? ", stale" : ""}`
    : worktree?.observation?.state === "ambiguous"
      ? `${worktree.observation.candidates.length} worktrees; choose`
      : "Choose a worktree";
  const label = worktree ? <AgentWorktreeLine view={worktree} /> : content;
  if (!enabled || !workspace)
    return (
      <span className="workspace-inspector-path" title={description}>
        {label}
      </span>
    );
  const trigger = (
    <button
      type="button"
      onClick={mobile ? () => onOpenChange(!open) : undefined}
      aria-expanded={mobile ? open : undefined}
      aria-haspopup={mobile ? "dialog" : undefined}
      className="workspace-inspector-path workspace-inspector-location"
      aria-label={
        worktree
          ? `${worktreeDescription}. Repository status and source`
          : `${description}. Repository status and source`
      }
      title="Repository status and source"
    >
      <span className="workspace-inspector-location-text">{label}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
  );
  const details = (
    <>
      {" "}
      {worktree ? <AgentWorktreePicker view={worktree} /> : null}
      {!worktree || worktree.target ? (
        <PullRequestCard
          key={connectionClientScopeKey(
            client,
            client.serverRuntimeGeneration,
            workspace.workspace_id,
            worktree?.selected?.canonicalRoot ??
              workspace.worktree?.checkout_path,
            workspace.cwd,
            worktree
              ? worktree.selected?.branch
              : workspace.worktree?.git_status?.branch,
            worktree?.target,
          )}
          client={client}
          workspaceId={workspace.workspace_id}
          branch={
            worktree
              ? (worktree.selected?.branch ?? undefined)
              : workspace.worktree?.git_status?.branch
          }
        />
      ) : null}
    </>
  );
  if (mobile)
    return (
      <>
        {trigger}
        {open ? (
          <WorkspaceInspectorLocationSheet onClose={() => onOpenChange(false)}>
            {details}
          </WorkspaceInspectorLocationSheet>
        ) : null}
      </>
    );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="workspace-inspector-repository-popover"
        align="start"
      >
        {details}
      </PopoverContent>
    </Popover>
  );
}
