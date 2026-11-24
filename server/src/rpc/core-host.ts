import { conversationRpc } from "../agent/conversation-rpc";
import { withCoreRecipient } from "../herdr-core/agent-sessions";
import type { CoreHostRuntime } from "../herdr-core/host-runtime";
import { inspectWorkspacePath } from "../workspace/path";
import {
  answersOnCore,
  coreHostRefusal,
  type CoreHostMethod,
} from "../../../shared/coreHostMethods";

export { answersOnCore };

/**
 * The connection methods a herdr-core connection answers (P4): workspace
 * Files, Git and an agent's worktree, through World's own guarded host
 * helpers on the core's host, and an agent's Chat, History and Details
 * through the same handlers a Herdr connection uses (agent-sessions.ts).
 * Everything else a Herdr (TUI) connection answers is refused for core,
 * never forwarded to it: core terminals, rooms and kills go through
 * world.core.*.
 */
const CORE_HOST_CALLS = {
  "file.list": (host) => host.files.listWorkspaceFiles,
  "file.resolve": (host) => host.files.resolveWorkspaceFiles,
  "file.mkdir": (host) => host.files.createWorkspaceDirectory,
  "file.move": (host) => host.files.moveWorkspaceFile,
  "file.read": (host) => host.files.readWorkspaceFile,
  "file.search": (host) => host.files.searchWorkspaceFiles,
  "git.diff_summary": (host) => host.files.readGitDiffSummary,
  "git.diff_file": (host) => host.files.readGitDiffFile,
  "git.pull_request": (host) => host.files.readWorkspacePullRequest,
  "git.commits": (host) => host.files.readGitCommits,
  "git.commit": (host) => host.files.readGitCommit,
  "git.commit_file": (host) => host.files.readGitCommitFile,
  "git.commit_preview": (host) => host.files.readGitCommitPreview,
  "git.pull": (host) => host.files.runGitPull,
  "git.file_action": (host) => host.files.runWorkspaceGitFileAction,
  "git.repo_action": (host) => host.files.runWorkspaceGitRepoAction,
  "worktree.list": (host) => (params: Record<string, unknown>) =>
    host.resources.listWorktrees({
      workspace_id: String(params.workspace_id ?? ""),
    }),
  "agent_worktree.get":
    (host) =>
    (params: Record<string, unknown>): Promise<unknown> =>
      host.agentWorktree.get(params.subject, {
        refresh: params.refresh === true,
      }),
  "agent_history.get": (host) => host.agentSessions().readHistoryRequest,
  "agent_history.entry": (host) => host.agentSessions().readEntry,
  "agent_session.get": (host) => host.agentSessions().readSummary,
  // A Codex session linked for reading, for the program the person saw.
  "agent_session.link_preview": (host) => (params) =>
    withCoreRecipient(params.recipient, () =>
      host.agentSessions().previewLink(params),
    ),
  "agent_session.link": (host) => (params) =>
    withCoreRecipient(params.recipient, () =>
      host.agentSessions().link(params),
    ),
  "agent_turn.get": (host) => host.agentSessions().readTurn,
  // Desk and Town read core agents' quests and artefacts as Herdr's.
  "agent_quest.list": (host) => async (params) => ({
    quests: await host
      .agentSessions()
      .conversation.quests(
        Array.isArray(params.pane_ids)
          ? params.pane_ids.filter((id): id is string => typeof id === "string")
          : undefined,
      ),
  }),
  // A new room's folder, completed and checked on the core's host.
  "workspace.path": (host) => (params: Record<string, unknown>) =>
    inspectWorkspacePath(params.path, {
      host: host.sshHost(),
      remotePlatform: host.remotePlatform,
      runProcessWithCodeTimeout: host.runProcessWithCodeTimeout,
    }),
} satisfies Record<
  Exclude<CoreHostMethod, "file.reveal" | ConversationMethod>,
  (
    host: CoreHostRuntime,
  ) => (params: Record<string, unknown>) => Promise<unknown>
>;

type ConversationMethod = Extract<
  CoreHostMethod,
  `agent_conversation.${string}`
>;

/** The browser asking, for a watch: who it is and how it is told. */
export type CoreHostRequester = {
  remoteAddress?: string;
  owner?: object;
  /** Tells the browser a pane it watches changed. */
  conversationChanged?(paneId: string): void;
};

/**
 * Answers one connection method on a core host runtime. `file.reveal` needs
 * the requesting browser's address (it opens this computer's file manager
 * only for a local browser); a conversation watch needs the browser.
 * Chat input goes only to the program the request's `recipient` names.
 */
export async function callCoreHost(
  host: CoreHostRuntime,
  method: string,
  params: Record<string, unknown>,
  requester: CoreHostRequester = {},
): Promise<unknown> {
  if (method === "file.reveal")
    return host.files.revealWorkspaceFile(
      params,
      requester.remoteAddress ?? "",
    );
  if (!answersOnCore(method)) throw new Error(coreHostRefusal(method));
  if (
    method === "agent_conversation.watch" ||
    method === "agent_conversation.unwatch"
  ) {
    const paneId = typeof params.pane_id === "string" ? params.pane_id : "";
    if (!paneId) throw new Error(`${method} requires pane_id`);
    const { owner, conversationChanged } = requester;
    if (!owner || !conversationChanged)
      throw new Error(`${method} needs a browser connection`);
    if (method === "agent_conversation.watch")
      host.agentSessions().watch(owner, paneId, conversationChanged);
    else host.agentSessions().unwatch(owner, paneId);
    return { ok: true };
  }
  if (method.startsWith("agent_conversation."))
    return withCoreRecipient(params.recipient, () =>
      conversationRpc(method, params, host.agentSessions().conversation),
    );
  return CORE_HOST_CALLS[
    method as Exclude<CoreHostMethod, "file.reveal" | ConversationMethod>
  ](host)(params);
}
