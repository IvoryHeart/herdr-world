import type { CodexDaemonThread } from "./codex-app-server";
import type { AgentSessionFileAccess } from "./session-file-access";
import type { HerdrCall } from "./session-types";
import { isRecord, normalizeAgentName, stringValue } from "./session-utils";

const RECENT_MS = 10 * 60_000;
const FUTURE_SKEW_MS = 30_000;

export function codexPaneCwd(info: Record<string, unknown>) {
  return stringValue(info.foreground_cwd) || stringValue(info.cwd);
}

/** Include every potential competitor, including panes already linked by title. */
export async function codexPanes(
  herdrCall: HerdrCall,
  listed?: readonly Record<string, unknown>[],
) {
  const result = listed
    ? { agents: listed }
    : await herdrCall("agent.list", {});
  if (!isRecord(result) || !Array.isArray(result.agents)) return null;
  const codex = result.agents.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && normalizeAgentName(stringValue(item.agent)) === "codex",
  );
  if (codex.some((item) => !stringValue(item.pane_id))) return null;
  return codex;
}

function witness(info: Record<string, unknown>) {
  return JSON.stringify([
    info.pane_id,
    info.terminal_id,
    codexPaneCwd(info),
    info.terminal_title,
    info.agent_status,
    info.agent_session ?? null,
    info.revision,
    info.state_change_seq,
  ]);
}

/**
 * Inference is read-only and ephemeral. Both sides must be unique, and pane
 * evidence must remain unchanged while querying this connection's daemon.
 */
export async function inferCodexDaemonThread(args: {
  paneId: string;
  info: Record<string, unknown>;
  files: AgentSessionFileAccess;
  herdrCall: HerdrCall;
}): Promise<CodexDaemonThread | null> {
  const { files, herdrCall, info, paneId } = args;
  const cwd = codexPaneCwd(info);
  if (!cwd || !files.listCodexThreads) return null;
  try {
    const before = await codexPanes(herdrCall);
    if (before?.some((pane) => !codexPaneCwd(pane))) return null;
    const candidates = before?.filter((pane) => codexPaneCwd(pane) === cwd);
    if (candidates?.length !== 1 || candidates[0]!.pane_id !== paneId)
      return null;
    const original = witness({ ...info, pane_id: paneId });
    if (witness(candidates[0]!) !== original) return null;
    const threads = await files.listCodexThreads(cwd);
    // Count all loaded candidates before considering recency or status. An old
    // or idle competitor must never disappear just to manufacture uniqueness.
    if (threads?.length !== 1) return null;
    const thread = threads[0]!;
    const clock = files.clockOffset ? await files.clockOffset() : null;
    const after = await codexPanes(herdrCall);
    if (after?.some((pane) => !codexPaneCwd(pane))) return null;
    const current = after?.filter((pane) => codexPaneCwd(pane) === cwd);
    if (
      current?.length !== 1 ||
      current[0]!.pane_id !== paneId ||
      witness(current[0]!) !== original
    )
      return null;
    // Never borrow a thread another pane explicitly reports or names.
    if (
      after!.some(
        (pane) =>
          pane.pane_id !== paneId &&
          ((isRecord(pane.agent_session) &&
            pane.agent_session.value === thread.id) ||
            stringValue(pane.terminal_title)
              .toLowerCase()
              .includes(thread.id.slice(0, 29))),
      )
    )
      return null;
    const now = Date.now() + (clock?.offsetMs ?? 0);
    const uncertainty = clock?.uncertaintyMs ?? 0;
    if (
      thread.cwd !== cwd ||
      thread.createdAt <= 0 ||
      thread.updatedAt < thread.createdAt ||
      thread.updatedAt > now + FUTURE_SKEW_MS - uncertainty ||
      now - thread.updatedAt + uncertainty > RECENT_MS
    )
      return null;
    const status = stringValue(info.agent_status);
    if (
      (status === "working" && thread.status === "active" && !thread.waiting) ||
      (status === "blocked" && thread.status === "active" && thread.waiting) ||
      (["idle", "done"].includes(status) && thread.status === "idle")
    )
      return thread;
    return null;
  } catch {
    return null;
  }
}
