import { createHash } from "node:crypto";
import { HerdrClient } from "../bridge/herdr-client";
import { createSshTunnelManager } from "../bridge/ssh-tunnel";
import { loadServerConfig, type ServerConfig } from "../config/server-config";
import { runProcess } from "../utils/process-utils";

export const TASK_SUMMARY_TOKEN = "task_summary";
export const TASK_SUMMARY_SESSION_TOKEN = "task_summary_session";
export const TASK_SUMMARY_SOURCE = "herdr-world:task-summary";
export const DEFAULT_TASK_SUMMARY_TTL_MS = 900_000;
export const MAX_TASK_SUMMARY_TTL_MS = 86_400_000;
export const MAX_TASK_SUMMARY_CODE_POINTS = 80;

type TaskSummaryCommand = {
  paneId: string;
  ttlMs: number;
  summary: string;
  transportArgs: string[];
};

type AgentSession = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};

type TaskSummaryClient = Pick<HerdrClient, "call">;

export type TaskSummaryCommandDeps = {
  loadConfig?: (appVersion: string) => ServerConfig;
  createClient?: (socketPath: string) => TaskSummaryClient;
  createTunnel?: (config: ServerConfig) => {
    startAutoSshTunnel(): Promise<void>;
    cleanupAutoSshTunnel(): Promise<void>;
  } | null;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function taskSummaryHelp() {
  return `Usage: herdr-world task-summary [TEXT] [--pane ID] [--session NAME] [--ssh-host DESTINATION] [--ttl-ms MS]

Reports a short, expiring summary for the exact pane's current Herdr agent session.
Use --pane or HERDR_PANE_ID. The default lifetime is 900000 ms. Herdr expires
the report; task-summary has no --clear command.`;
}

function usage(message: string): never {
  throw new Error(message);
}

function nonEmpty(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) usage(`${label} must not be empty`);
  return trimmed;
}

function redactTaskSummary(value: string) {
  const patterns = [
    /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu,
    /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{12,})\b/gu,
  ];
  return patterns.reduce(
    (summary, pattern) => summary.replace(pattern, "[redacted]"),
    value,
  );
}

export function normalizeTaskSummary(value: string) {
  const normalized = value
    .replace(/[\p{White_Space}\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .trim();
  if (!normalized) usage("task summary must not be empty");
  const redacted = redactTaskSummary(normalized);
  const codePoints = Array.from(redacted);
  if (codePoints.length <= MAX_TASK_SUMMARY_CODE_POINTS) return redacted;
  return `${codePoints
    .slice(0, MAX_TASK_SUMMARY_CODE_POINTS - 1)
    .join("")
    .trimEnd()}…`;
}

export function taskSummarySessionFingerprint(session: AgentSession) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        session.source,
        session.agent,
        session.kind,
        session.value,
      ]),
    )
    .digest("hex");
}

function parseAgentSession(value: unknown): AgentSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    usage("target pane has no active agent session");
  }
  const session = value as Record<string, unknown>;
  const fields = ["source", "agent", "kind", "value"] as const;
  const result = {} as AgentSession;
  for (const field of fields) {
    if (typeof session[field] !== "string" || !session[field].trim()) {
      usage("target pane has an incomplete agent session");
    }
    result[field] = session[field];
  }
  return result;
}

function parseTaskSummaryCommand(args: string[]): TaskSummaryCommand | null {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return null;
  }
  let paneId: string | undefined;
  let ttlMs: number | undefined;
  const summaryParts: string[] = [];
  const transportArgs: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (positionalOnly) {
      summaryParts.push(arg);
      continue;
    }
    if (arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (arg === "--clear") {
      usage("task-summary does not support --clear; reports expire by TTL");
    }
    if (arg === "--pane" || arg === "--ttl-ms") {
      const value = args[++index];
      if (value === undefined) usage(`missing value for ${arg}`);
      if (arg === "--pane") {
        if (paneId !== undefined) usage("--pane may only be specified once");
        paneId = nonEmpty(value, "pane ID");
      } else {
        if (ttlMs !== undefined) usage("--ttl-ms may only be specified once");
        if (!/^\d+$/u.test(value)) {
          usage(`--ttl-ms must be between 1 and ${MAX_TASK_SUMMARY_TTL_MS}`);
        }
        const parsed = Number(value);
        if (
          !Number.isSafeInteger(parsed) ||
          parsed < 1 ||
          parsed > MAX_TASK_SUMMARY_TTL_MS
        ) {
          usage(`--ttl-ms must be between 1 and ${MAX_TASK_SUMMARY_TTL_MS}`);
        }
        ttlMs = parsed;
      }
      continue;
    }
    if (
      arg === "--session" ||
      arg === "--ssh-host" ||
      arg === "--socket-path" ||
      arg === "--client-socket-path"
    ) {
      const value = args[++index];
      if (value === undefined) usage(`missing value for ${arg}`);
      transportArgs.push(arg, value);
      continue;
    }
    if (arg.startsWith("-")) usage(`unknown task-summary option: ${arg}`);
    summaryParts.push(arg);
  }

  const resolvedPaneId = paneId ?? process.env.HERDR_PANE_ID;
  if (!resolvedPaneId?.trim()) {
    usage("task-summary requires --pane or HERDR_PANE_ID");
  }
  return {
    paneId: nonEmpty(resolvedPaneId, "pane ID"),
    ttlMs: ttlMs ?? DEFAULT_TASK_SUMMARY_TTL_MS,
    summary: normalizeTaskSummary(summaryParts.join(" ")),
    transportArgs,
  };
}

function stripTaskSummaryArgv(transportArgs: readonly string[]) {
  if (process.argv[2] === "task-summary") {
    process.argv.splice(2, process.argv.length - 2, ...transportArgs);
  }
}

async function reportTaskSummary(
  client: TaskSummaryClient,
  command: TaskSummaryCommand,
) {
  const pane = await client.call("pane.get", { pane_id: command.paneId });
  if (!pane || typeof pane !== "object" || Array.isArray(pane)) {
    usage("Herdr returned an invalid pane response");
  }
  const result = pane as Record<string, unknown>;
  const paneRecord =
    result.pane &&
    typeof result.pane === "object" &&
    !Array.isArray(result.pane)
      ? (result.pane as Record<string, unknown>)
      : result;
  if (paneRecord.pane_id !== command.paneId) {
    usage("Herdr did not return the requested pane");
  }
  const session = parseAgentSession(paneRecord.agent_session);
  await client.call("pane.report_metadata", {
    pane_id: command.paneId,
    source: TASK_SUMMARY_SOURCE,
    tokens: {
      [TASK_SUMMARY_TOKEN]: command.summary,
      [TASK_SUMMARY_SESSION_TOKEN]: taskSummarySessionFingerprint(session),
    },
    ttl_ms: command.ttlMs,
  });
}

/**
 * Handles the one-shot producer before World loads server configuration or opens
 * listeners. Returns null when the command is not a task-summary invocation.
 */
export async function runTaskSummaryCommand(
  args: string[],
  appVersion: string,
  dependencies: TaskSummaryCommandDeps = {},
): Promise<number | null> {
  if (args[0] !== "task-summary") return null;
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;
  let command: TaskSummaryCommand | null;
  try {
    command = parseTaskSummaryCommand(args.slice(1));
  } catch (cause) {
    error(`task-summary: ${(cause as Error).message}`);
    error(taskSummaryHelp());
    return 2;
  }
  if (!command) {
    log(taskSummaryHelp());
    return 0;
  }

  let tunnel:
    | ReturnType<NonNullable<TaskSummaryCommandDeps["createTunnel"]>>
    | undefined;
  try {
    stripTaskSummaryArgv(command.transportArgs);
    const config = (dependencies.loadConfig ?? loadServerConfig)(appVersion);
    const createTunnel =
      dependencies.createTunnel ??
      ((target: ServerConfig) =>
        target.sshHost
          ? createSshTunnelManager({
              config: target,
              runProcess,
            })
          : null);
    tunnel = createTunnel(config);
    await tunnel?.startAutoSshTunnel();
    const client = (
      dependencies.createClient ??
      ((socketPath: string) => new HerdrClient(socketPath))
    )(config.socketPath);
    await reportTaskSummary(client, command);
    log(
      JSON.stringify({
        pane_id: command.paneId,
        status: "reported",
        ttl_ms: command.ttlMs,
      }),
    );
    return 0;
  } catch {
    error("task-summary: unable to report to the requested Herdr pane");
    return 1;
  } finally {
    await tunnel?.cleanupAutoSshTunnel();
  }
}
