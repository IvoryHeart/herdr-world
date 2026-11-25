/**
 * The connection methods a herdr-core connection answers: workspace Files,
 * Git, an agent's worktree and its Chat, History and Details (the same
 * Inspector components as a Herdr agent's), its desk read (quest, usage
 * stop and artefacts, `agent_quest.list`), and a new room's folder
 * completion (`workspace.path`). Every other method a Herdr
 * (TUI) connection answers is Herdr-only; the service refuses it for core
 * and the page never sends it (core terminals and kills go through
 * `world.core.*`).
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
  "agent_conversation.get",
  "agent_conversation.latest",
  "agent_conversation.steps",
  "agent_conversation.send",
  "agent_conversation.answer",
  "agent_conversation.press",
  "agent_conversation.trust",
  "agent_conversation.dismiss",
  "agent_conversation.watch",
  "agent_conversation.unwatch",
  "agent_history.get",
  "agent_history.entry",
  "agent_session.get",
  "agent_session.link_preview",
  "agent_session.link",
  "agent_turn.get",
  "agent_quest.list",
  "workspace.path",
] as const;

export type CoreHostMethod = (typeof CORE_HOST_METHODS)[number];

const ANSWERED: ReadonlySet<string> = new Set(CORE_HOST_METHODS);

/** Whether a herdr-core connection answers `method`. */
export function answersOnCore(method: string): method is CoreHostMethod {
  return ANSWERED.has(method);
}

/** Why a core connection refuses `method`, the same words on page and service. */
export function coreHostRefusal(method: string): string {
  return `${method} is not available on a herdr-core connection; World offers its files, Git, worktrees and Chat.`;
}
