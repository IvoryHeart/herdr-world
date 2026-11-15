import { isAbsolute } from "node:path";
import type {
  CoreHistory,
  CoreHistorySession,
} from "../../../shared/coreHistory";
import { normalizeAgentName, SESSION_AGENTS } from "../agent/chat-harnesses";
import { claudeConfigDirectory } from "../agent/claude-process-session";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import { readSessionProjection } from "../agent/session-projection-cache";
import {
  createAgentSessionResolverContext,
  resolveAgentSessionInfo,
} from "../agent/session-resolver";
import type { ReadyRuntimeLease } from "../connections/manager";
import { CoreOperationFence } from "./fence";
import { CORE_RECIPIENT, coreRecipientChange } from "./recipient";
import type { CoreConnectionRuntime } from "./runtime";
import { harnessName, harnessOfArgv } from "./harness";
import { coreHarness } from "./topology";

/** Resume flags verified in Herdr's agent_resume.rs, not guessed filenames,
 * and the caller-chosen IDs World launches with (operations.ts). */
export function argvSession(
  agent: string,
  argv: unknown,
): CoreHistorySession | undefined {
  if (!Array.isArray(argv)) return;
  const flags =
    agent === "claude"
      ? ["--resume", "--session-id"]
      : agent === "pi"
        ? ["--session", "--session-id"]
        : agent === "kimi"
          ? ["--session"]
          : agent === "omp"
            ? ["--resume"]
            : [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== "string") continue;
    const flag = flags.find((f) => arg === f || arg.startsWith(`${f}=`));
    const value = flag
      ? arg.includes("=")
        ? arg.slice(flag.length + 1)
        : argv[i + 1]
      : agent === "codex" && arg === "resume"
        ? argv[i + 1]
        : undefined;
    if (typeof value === "string" && value && !value.startsWith("-"))
      return { kind: isAbsolute(value) ? "path" : "id", value };
  }
}

/**
 * The session Claude Code's own record names for the process in the
 * terminal's foreground, read on the agent's host. Only a foreground that
 * is Claude itself counts: core's foreground pid is its process group's
 * leader, so a wrapper leading the group is no evidence. A failed read is
 * no evidence either.
 */
export async function processSession(
  agent: string,
  foreground: { pid?: unknown; name?: unknown; argv?: unknown } | undefined,
  files: AgentSessionFileAccess,
): Promise<CoreHistorySession | undefined> {
  if (
    agent !== "claude" ||
    !files.findClaudeSessionForProcess ||
    typeof foreground?.pid !== "number" ||
    (harnessOfArgv(foreground.argv) ?? harnessName(foreground.name)) !==
      "claude"
  )
    return;
  const id = await files
    .findClaudeSessionForProcess(foreground.pid)
    .catch(() => null);
  return id ? { kind: "id", value: id } : undefined;
}

export function parseCoreHistorySession(
  value: unknown,
): CoreHistorySession | undefined {
  if (value === undefined || value === null) return;
  const session = value as Partial<CoreHistorySession>;
  if (
    (session.kind !== "id" && session.kind !== "path") ||
    typeof session.value !== "string" ||
    !session.value.trim() ||
    session.value.length > 4096 ||
    /[\x00-\x1f]/.test(session.value) ||
    (session.kind === "path" && !isAbsolute(session.value))
  )
    throw new Error(
      "Enter a session ID or an absolute transcript path on this host.",
    );
  return { kind: session.kind, value: session.value.trim() };
}

/** Reuses the TUI transcript readers only. Core owns status and all input.
 * Core has no session-report API: the agent's own per-process record,
 * titles/launch argv and the existing read-only discovery can identify
 * history, or the person can link it.
 * Such a link is a reading choice, never input authority. Both native get
 * replies and the original lease/occupant fence surround the host file read. */
export async function readCoreHistory(
  lease: ReadyRuntimeLease<CoreConnectionRuntime>,
  address: string,
  recipient: string,
  options: {
    files: AgentSessionFileAccess;
    windows?: boolean;
    session?: CoreHistorySession;
  },
): Promise<CoreHistory> {
  if (!CORE_RECIPIENT.test(recipient))
    throw new Error("The agent changed; reopen its Chat.");
  const fence = CoreOperationFence.admit(lease, address);
  const view = lease.runtime.core;
  const record = await lease.runtime.inspect(fence);
  const check = (now: typeof record) => {
    fence.check("publication");
    if (
      coreRecipientChange(
        recipient,
        view.epoch!.coreId,
        now,
        view.occupancy(address),
      )
    )
      throw new Error("The agent changed; reopen its Chat.");
  };
  check(record);
  const unavailable = (reason: string, detail: string): CoreHistory => ({
    status: "unavailable",
    reason,
    detail,
    entries: [],
  });
  if (options.windows)
    return unavailable(
      "unsupported_platform",
      "Chat cannot read conversations on a Windows host yet. Messages and answer keys still use core.",
    );
  const agent = normalizeAgentName(
    coreHarness({ ...record, remote: false }) ?? "",
  );
  if (!SESSION_AGENTS.has(agent))
    return unavailable(
      "unsupported_harness",
      `World has no transcript reader for ${agent || "this program"}. Messages and answer keys still use core.`,
    );
  const foreground = record.foreground as
    | { pid?: unknown; name?: unknown; argv?: unknown; cwd?: unknown }
    | undefined;
  const linked = parseCoreHistorySession(options.session);
  // The process's own record follows /clear and /resume; launch arguments
  // name only the session it started with.
  const recorded = linked
    ? undefined
    : await processSession(agent, foreground, options.files);
  const session =
    linked ??
    recorded ??
    argvSession(agent, foreground?.argv) ??
    argvSession(agent, record.argv);
  if (
    options.files.remote &&
    (agent === "grok" ||
      agent === "agy" ||
      (session?.kind === "id" && !["codex", "pi", "claude"].includes(agent)))
  )
    return unavailable(
      "remote_lookup",
      "This reader needs a transcript path on the SSH host; Grok and Antigravity history are local-only.",
    );
  const resolved = await resolveAgentSessionInfo(
    { pane_id: address },
    {
      agent,
      cwd: record.cwd,
      foreground_cwd: foreground?.cwd,
      agent_status: (record.status as { state?: string } | undefined)?.state,
      terminal_title: linked ? "" : record.title,
      ...(session
        ? {
            agent_session: {
              ...session,
              source: linked
                ? "world-link"
                : recorded
                  ? "core-process"
                  : "core-argv",
              agent,
            },
          }
        : {}),
    },
    options.files,
    // Local transcripts live under the directory the process record came
    // from; an SSH host resolves its own.
    createAgentSessionResolverContext(undefined, {
      claudeConfigDir: options.files.remote
        ? undefined
        : claudeConfigDirectory(),
    }),
  );
  let result: CoreHistory;
  if (
    !resolved.file &&
    session &&
    !linked &&
    resolved.reason === "file_missing"
  )
    // Claude and pi write a transcript only once the conversation starts.
    result = unavailable(
      "no_messages_yet",
      "This agent's conversation has no saved messages yet. Refresh after it replies, or link its transcript if it keeps them elsewhere.",
    );
  else if (!resolved.file)
    result = unavailable(
      resolved.reason ?? "no_session",
      "No readable conversation was identified. Link its session ID or transcript path on this host, or use Terminal.",
    );
  else {
    const projection = await readSessionProjection(
      agent,
      resolved.file,
      options.files,
    );
    // Bound the wire payload separately from the readers' 200-entry window.
    let budget = 256_000;
    let truncated = false;
    const entries = projection.entries.map((entry) => {
      const text = entry.text.slice(0, Math.min(16_000, budget));
      budget -= text.length;
      truncated ||= text.length !== entry.text.length;
      return { ...entry, text };
    });
    result = {
      status: "ok",
      detail: "Latest 200 transcript entries. Refresh to read new messages.",
      entries,
      truncated,
      source: linked
        ? "linked"
        : session || resolved.session?.source === "codex-title"
          ? "native"
          : "discovered",
    };
  }
  const after = await lease.runtime.inspect(fence);
  check(after);
  // A title/resume switch within the same process invalidates this read too.
  if (
    record.title !== after.title ||
    JSON.stringify(foreground?.argv) !==
      JSON.stringify((after.foreground as { argv?: unknown } | undefined)?.argv)
  )
    throw new Error("The conversation changed while reading it. Refresh Chat.");
  return result;
}
