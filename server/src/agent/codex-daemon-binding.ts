import type { CodexDaemonThread } from "./codex-app-server";
import type { AgentSessionFileAccess } from "./session-file-access";
import type { HerdrCall } from "./session-types";
import type { CodexDiscoveryCache } from "./codex-discovery-cache";
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

export type CodexInferenceBatch = {
  before: Record<string, unknown>[] | null;
  after: Record<string, unknown>[] | null;
  threads: CodexDaemonThread[] | null;
  clock: { offsetMs: number; uncertaintyMs: number } | null;
};

/** Two phases: finish the single daemon read before taking the final pane set. */
export async function prepareCodexInferenceBatch(args: {
  listed: readonly Record<string, unknown>[];
  files: AgentSessionFileAccess;
  herdrCall: HerdrCall;
  discovery: CodexDiscoveryCache;
}): Promise<CodexInferenceBatch> {
  const initial = await codexPanes(args.herdrCall, args.listed);
  const before = initial?.map((pane) => structuredClone(pane)) ?? null;
  const batch: CodexInferenceBatch = {
    before,
    after: null,
    threads: null,
    clock: null,
  };
  if (
    !before ||
    before.some((pane) => !codexPaneCwd(pane)) ||
    !args.files.listCodexThreads
  )
    return batch;
  const eligible = before.filter(
    (pane) =>
      pane.agent_session == null &&
      !/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{5,12}/i.test(
        stringValue(pane.terminal_title),
      ) &&
      before.filter((other) => codexPaneCwd(other) === codexPaneCwd(pane))
        .length === 1,
  );
  const cwds = [...new Set(eligible.map(codexPaneCwd))];
  if (!cwds.length) return batch;
  try {
    let query: Promise<Map<string, CodexDaemonThread[] | null>> | undefined;
    const requested = new Set<string>();
    const snapshot = JSON.stringify(before.map(witness).sort());
    const results = await Promise.all(
      cwds.map((cwd) =>
        args.discovery.read(
          cwd,
          snapshot,
          async () => {
            requested.add(cwd);
            // Collect cache misses before opening this snapshot's one proxy.
            await Promise.resolve();
            const directories = [...requested];
            query ??= args.files.listCodexThreadBatch
              ? args.files.listCodexThreadBatch(directories)
              : Promise.all(
                  directories.map(
                    async (directory) =>
                      [
                        directory,
                        await args.files.listCodexThreads!(directory),
                      ] as const,
                  ),
                ).then((rows) => new Map(rows));
            return (await query).get(cwd) ?? null;
          },
          "snapshot",
        ),
      ),
    );
    if (results.every((threads) => threads === null)) return batch;
    batch.threads = results.flatMap((threads) => threads ?? []);
    batch.clock = args.files.clockOffset
      ? await args.files.clockOffset()
      : null;
    batch.after = await codexPanes(args.herdrCall);
  } catch {
    batch.threads = null;
  }
  return batch;
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
  discovery: CodexDiscoveryCache;
  batch?: CodexInferenceBatch;
}): Promise<CodexDaemonThread | null> {
  const { files, herdrCall, info, paneId } = args;
  const cwd = codexPaneCwd(info);
  if (!cwd || !files.listCodexThreads) return null;
  try {
    const before = args.batch ? args.batch.before : await codexPanes(herdrCall);
    if (before?.some((pane) => !codexPaneCwd(pane))) return null;
    const candidates = before?.filter((pane) => codexPaneCwd(pane) === cwd);
    if (candidates?.length !== 1 || candidates[0]!.pane_id !== paneId)
      return null;
    const original = witness({ ...info, pane_id: paneId });
    if (witness(candidates[0]!) !== original) return null;
    const threads = args.batch
      ? args.batch.threads
      : await args.discovery.read(
          cwd,
          JSON.stringify(before!.map(witness).sort()),
          () => files.listCodexThreads!(cwd),
        );
    if (!threads) return null;
    const clock = args.batch
      ? args.batch.clock
      : files.clockOffset
        ? await files.clockOffset()
        : null;
    const now = Date.now() + (clock?.offsetMs ?? 0);
    const uncertainty = clock?.uncertaintyMs ?? 0;
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(uncertainty) ||
      uncertainty < 0
    )
      return null;
    // Keep every loaded contender, and recent or malformed unloaded evidence.
    // Only a valid, old unloaded thread can be excluded from the count.
    const contenders = threads.filter(
      (thread) =>
        thread.cwd === cwd &&
        (thread.status !== "notLoaded" ||
          thread.createdAt <= 0 ||
          thread.updatedAt < thread.createdAt ||
          thread.updatedAt > now + FUTURE_SKEW_MS - uncertainty ||
          now - thread.updatedAt - uncertainty <= RECENT_MS),
    );
    if (contenders.length !== 1 || contenders[0]!.status === "notLoaded")
      return null;
    const thread = contenders[0]!;
    const after = args.batch ? args.batch.after : await codexPanes(herdrCall);
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
