import {
  type AssistantWorkspace,
  type AssistantMentionTarget,
  isAssistantMentionTarget,
} from "../../../shared/assistant";
import { isRecord } from "../agent/session-utils";
import { validateConnectionId } from "../connections/protocol";
import { createHash } from "node:crypto";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { CoreHostRuntime } from "../herdr-core/host-runtime";
import { captureOccupant } from "../herdr-core/fence";

/**
 * What Ranger reads through: a Herdr (TUI) connection runtime, or a
 * herdr-core connection's host runtime (P4), which answers the same
 * workspace, terminal and Git reads from World's read model of that core.
 */
export type AssistantRuntime = LegacyConnectionRuntime | CoreHostRuntime;

export type RuntimeLease = {
  runtime: AssistantRuntime;
  generation: number;
  isCurrent(): boolean;
};

/** The core host runtime behind a lease, or null for a Herdr (TUI) one. */
export function assistantCoreRuntime(
  runtime: AssistantRuntime,
): CoreHostRuntime | null {
  return "runtime" in runtime && runtime.runtime === "herdr-core"
    ? runtime
    : null;
}

/** Ranger never reads a core agent's transcript: World has none yet (M4). */
export const CORE_HISTORY_UNAVAILABLE =
  "Agent history is not available for herdr-core agents yet: World reads no transcripts there. Read the terminal screen instead.";
export const CORE_TERMINAL_WINDOW =
  "Only the visible screen of a herdr-core terminal; its history is never read, because reading it would scroll a full-screen program. The requested line count does not apply";

/**
 * Who runs in a core terminal, as a mention binds it: the program core
 * started there (core, address, pid and occupancy) and its harness. A
 * replacement keeps the address and may reuse the pid, but changes the
 * occupancy, so the mention no longer matches.
 */
export function coreAgentIdentity(
  core: CoreHostRuntime,
  paneId: string,
  agent: string,
): string | null {
  const occupant = captureOccupant(core.lease.runtime.core, paneId);
  if (!occupant) return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "herdr-core",
        occupant.coreId,
        occupant.address,
        occupant.pid,
        occupant.occupancy,
        agent,
      ]),
    )
    .digest("hex");
}

export async function recoveryIdentity(
  lease: RuntimeLease,
  signal: AbortSignal | undefined,
  readLeased: <T>(
    lease: RuntimeLease,
    op: () => Promise<T>,
    label: string,
    signal?: AbortSignal,
  ) => Promise<T>,
) {
  const core = assistantCoreRuntime(lease.runtime);
  // A core keeps its terminals across its own restarts: its durable ID is
  // the server identity a task resumes against, and a wiped core is new.
  if (core)
    return readLeased(
      lease,
      async () => core.lease.runtime.core.epoch?.coreId ?? null,
      "Ranger recovery server identity",
      signal,
    );
  const tui = lease.runtime as LegacyConnectionRuntime;
  if (!tui.recoveryIdentity) return null;
  return readLeased(
    lease,
    () => tui.recoveryIdentity(signal),
    "Ranger recovery server identity",
    signal,
  );
}

export async function coreAgentMention(
  target: AssistantWorkspace,
  core: CoreHostRuntime,
  paneId: string,
  base: AssistantMentionTarget,
  label: (value: unknown, fallback: string) => string,
  read: <T>(operation: () => Promise<T>) => Promise<T>,
): Promise<Extract<AssistantMentionTarget, { kind: "agent" }>> {
  const { pane, agent } = await read(async () => ({
    pane: (await core.operations.getTerminal({ pane_id: paneId })).pane,
    agent: (await core.operations.getAgent({ target: paneId })).agent,
  }));
  const harness = typeof pane?.agent === "string" ? pane.agent : "";
  const identity = harness ? coreAgentIdentity(core, paneId, harness) : null;
  if (
    !isRecord(pane) ||
    pane.pane_id !== paneId ||
    pane.workspace_id !== target.workspace_id ||
    !identity
  )
    throw new Error("Agent session is not available for mention");
  const result = {
    ...base,
    kind: "agent" as const,
    pane_id: validateConnectionId(paneId),
    terminal_id: validateConnectionId(pane.terminal_id),
    agent: harness,
    agent_identity: identity,
    label: label(agent?.name, harness),
  };
  if (!isAssistantMentionTarget(result))
    throw new Error("Agent session is not available for mention");
  return result;
}
