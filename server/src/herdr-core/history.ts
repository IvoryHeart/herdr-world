/**
 * Which harness session a core agent's terminal names, for the shared
 * session resolver (agent-sessions.ts): the agent's own per-process record,
 * then its launch arguments. Core has no session-report API.
 */
import { isAbsolute } from "node:path";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import { harnessName, harnessOfArgv } from "./harness";

/** A session named by ID or by an absolute transcript path. */
export type CoreHistorySession = { kind: "id" | "path"; value: string };

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
