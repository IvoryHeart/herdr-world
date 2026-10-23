import type { LogLevel } from "./logger";

// RPC error text for terminal calls made before a terminal is attached. The
// terminal bridge throws this exact message and the classifier below treats
// it as an expected detach race, so both sides share one constant.
export const NO_TERMINAL_ATTACHED_MESSAGE = "no terminal attached";

export function isExpectedRpcError(
  method: string | null,
  detail: string | undefined,
): boolean {
  const message = detail?.toLowerCase() ?? "";
  if (!message) return false;
  if (message.includes("connection changed during request")) return true;
  if (
    message.includes("connection runtime generation") ||
    message.includes("connection is not ready")
  ) {
    return true;
  }
  if (
    method === "git.diff_summary" &&
    /not (?:inside )?a git repository/.test(message)
  ) {
    return true;
  }
  if (
    method?.startsWith("terminal.") &&
    message === NO_TERMINAL_ATTACHED_MESSAGE
  ) {
    return true;
  }
  return false;
}

export function rpcLogLevel(args: {
  method: string | null;
  status: "ok" | "error";
  detail?: string;
}): LogLevel {
  if (args.status === "ok") return "debug";
  return isExpectedRpcError(args.method, args.detail) ? "debug" : "warn";
}

const IMPORTANT_RPC_METHODS = new Set([
  "bridge.pause_others",
  "agent_conversation.get",
  "agent_conversation.latest",
  "agent_conversation.steps",
  "agent_conversation.send",
  "agent_conversation.dismiss",
  "agent_conversation.answer",
  "agent_conversation.watch",
  "agent_conversation.unwatch",
  "agent_history.get",
  "agent_history.entry",
  "agent_session.get",
  "agent_turn.get",
  "agent_checkout.get",
  "agent_session.link_preview",
  "agent_session.link",
  "file.read",
  "git.diff_file",
  "git.commit_file",
  "git.commit_preview",
  "git.file_action",
  "git.pull",
  "git.repo_action",
  "settings.update_repo",
  "settings.workspace_auto_sync.get",
  "settings.workspace_auto_sync.list",
  "settings.workspace_auto_sync.update",
  "settings.workspace_auto_sync.update_key",
  "settings.worktree_hooks.get",
  "worktree.create",
  "worktree.open",
  "worktree.remove",
]);
const SLOW_RPC_LOG_MS = 750;

export function shouldLogRpc(
  method: string | null,
  elapsedMs: number,
  failed: boolean,
) {
  if (!method) return failed;
  if (failed) return true;
  if (method === "bridge.ping" || method === "bridge.status") return false;
  if (method === "terminal.input" || method === "terminal.scroll") return false;
  if (method === "terminal.resize" && elapsedMs < SLOW_RPC_LOG_MS) return false;
  return IMPORTANT_RPC_METHODS.has(method) || elapsedMs >= SLOW_RPC_LOG_MS;
}
