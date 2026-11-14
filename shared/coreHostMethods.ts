/**
 * The connection methods a herdr-core connection answers: workspace Files,
 * Git and an agent's worktree. Every other method a Herdr (TUI) connection
 * answers is Herdr-only; the service refuses it for core and the page never
 * sends it (core terminals, Chat and kills go through `world.core.*`).
 */
export const CORE_HOST_METHODS = [
  "file.list",
  "file.resolve",
  "file.mkdir",
  "file.move",
  "file.read",
  "file.search",
  "file.reveal",
  "git.diff_summary",
  "git.diff_file",
  "git.pull_request",
  "git.commits",
  "git.commit",
  "git.commit_file",
  "git.commit_preview",
  "git.pull",
  "git.file_action",
  "git.repo_action",
  "worktree.list",
  "agent_worktree.get",
] as const;

export type CoreHostMethod = (typeof CORE_HOST_METHODS)[number];

const ANSWERED: ReadonlySet<string> = new Set(CORE_HOST_METHODS);

/** Whether a herdr-core connection answers `method`. */
export function answersOnCore(method: string): method is CoreHostMethod {
  return ANSWERED.has(method);
}

/** Why a core connection refuses `method`, the same words on page and service. */
export function coreHostRefusal(method: string): string {
  return `${method} is not available on a herdr-core connection; World offers its files, Git and worktrees.`;
}
