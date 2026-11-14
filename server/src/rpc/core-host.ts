import type { CoreHostRuntime } from "../herdr-core/host-runtime";
import {
  answersOnCore,
  coreHostRefusal,
  type CoreHostMethod,
} from "../../../shared/coreHostMethods";

export { answersOnCore };

/**
 * The connection methods a herdr-core connection answers (P4): workspace
 * Files, Git and an agent's worktree, through World's own guarded host
 * helpers on the core's host. Everything else a Herdr (TUI) connection
 * answers is refused for core, never forwarded to it: core terminals,
 * rooms and kills go through world.core.*.
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
} satisfies Record<
  Exclude<CoreHostMethod, "file.reveal">,
  (
    host: CoreHostRuntime,
  ) => (params: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Answers one connection method on a core host runtime. `file.reveal` needs
 * the requesting browser's address (it opens this computer's file manager
 * only for a local browser).
 */
export async function callCoreHost(
  host: CoreHostRuntime,
  method: string,
  params: Record<string, unknown>,
  remoteAddress?: string,
): Promise<unknown> {
  if (method === "file.reveal")
    return host.files.revealWorkspaceFile(params, remoteAddress ?? "");
  if (!answersOnCore(method)) throw new Error(coreHostRefusal(method));
  return CORE_HOST_CALLS[method as Exclude<CoreHostMethod, "file.reveal">](
    host,
  )(params);
}
