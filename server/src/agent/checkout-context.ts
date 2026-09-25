import { isAbsolute } from "node:path";
import { sshCommandArgv } from "../bridge/ssh-command";
import {
  AGENT_CHECKOUT_VERSION,
  agentCheckoutSessionFingerprint,
} from "../herdr/agent-checkout";
import type { RunProcessWithCodeTimeout } from "../workspace/file-types";

const MAX_FILES = 200;
const TIMEOUT_MS = 8_000;
type AgentSession = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};
type Herdr = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

export type AgentCheckoutContext =
  | { available: false; reason: string }
  | {
      available: true;
      checkout_path: string;
      branch: string | null;
      worktree: "main" | "linked" | "detached";
      changed_files: Array<{ path: string; status: string }>;
      changed_count: number;
      truncated: boolean;
      reported_pr?: string;
    };

function paneRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.pane &&
    typeof record.pane === "object" &&
    !Array.isArray(record.pane)
    ? (record.pane as Record<string, unknown>)
    : record;
}
function session(value: unknown): AgentSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    ["source", "agent", "kind", "value"].some(
      (key) => typeof source[key] !== "string" || !source[key],
    )
  )
    return null;
  return source as unknown as AgentSession;
}
function decodeChunks(
  tokens: Record<string, unknown>,
  prefix: string,
  count: number,
) {
  const parts: string[] = [];
  let ended = false;
  for (let index = 0; index < count; index += 1) {
    const value = tokens[`${prefix}_${index}`];
    if (value === null || value === undefined) {
      ended = true;
      continue;
    }
    if (
      ended ||
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/u.test(value)
    )
      return null;
    parts.push(value);
  }
  if (!parts.length) return "";
  try {
    const encoded = parts.join("");
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return Buffer.from(decoded, "utf8").toString("base64url") === encoded
      ? decoded
      : null;
  } catch {
    return null;
  }
}
function validPr(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function unavailable(reason: string): AgentCheckoutContext {
  return { available: false, reason };
}

export function parseAgentCheckoutTokens(
  tokensValue: unknown,
  currentSession: AgentSession,
): { path: string; reportedPr?: string } | null {
  if (
    !tokensValue ||
    typeof tokensValue !== "object" ||
    Array.isArray(tokensValue)
  )
    return null;
  const tokens = tokensValue as Record<string, unknown>;
  if (
    tokens.agent_checkout_v !== AGENT_CHECKOUT_VERSION ||
    tokens.agent_checkout_session !==
      agentCheckoutSessionFingerprint(currentSession)
  )
    return null;
  const path = decodeChunks(tokens, "agent_checkout_path", 9);
  const pr = decodeChunks(tokens, "agent_checkout_pr", 4);
  if (
    !path ||
    pr === null ||
    !isAbsolute(path) ||
    Buffer.byteLength(path, "utf8") > 540 ||
    (pr && (!validPr(pr) || Buffer.byteLength(pr, "utf8") > 240))
  )
    return null;
  return { path, ...(pr ? { reportedPr: pr } : {}) };
}

export function parseAgentCheckoutStatus(output: string) {
  const lines = output.split(/\r?\n/u);
  const root = lines.shift()?.trim();
  const branchLine = lines.shift()?.trim();
  const worktreeLine = lines.shift()?.trim();
  if (!root || !branchLine || !worktreeLine) return null;
  const branch = branchLine === "HEAD" ? null : branchLine;
  const worktree = /(?:^|\/)\.git\/worktrees\//u.test(worktreeLine)
    ? "linked"
    : branch
      ? "main"
      : "detached";
  const changed_files: Array<{ path: string; status: string }> = [];
  let changed_count = 0;
  for (const line of lines) {
    if (!line || line.startsWith("## ")) continue;
    const status = line.slice(0, 2).trim() || "?";
    const path = line.slice(3).trim();
    if (!path) continue;
    changed_count += 1;
    if (changed_files.length < MAX_FILES) changed_files.push({ path, status });
  }
  return {
    checkout_path: root,
    branch,
    worktree,
    changed_files,
    changed_count,
    truncated: changed_count > changed_files.length,
  } as const;
}

export function createAgentCheckoutContext(args: {
  herdr: Herdr;
  sshHost: () => string | undefined;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
  shQuote: (value: string) => string;
}) {
  return async function get(
    params: Record<string, unknown>,
  ): Promise<AgentCheckoutContext> {
    const paneId =
      typeof params.pane_id === "string" && params.pane_id
        ? params.pane_id
        : null;
    const expected =
      typeof params.agent_session_fingerprint === "string" &&
      /^[a-f0-9]{64}$/u.test(params.agent_session_fingerprint)
        ? params.agent_session_fingerprint
        : null;
    if (!paneId || !expected)
      throw new Error(
        "agent_checkout.get requires pane_id and agent_session_fingerprint",
      );
    const pane = paneRecord(
      await args.herdr.call("pane.get", { pane_id: paneId }),
    );
    if (!pane || pane.pane_id !== paneId)
      return unavailable(
        "Agent checkout unavailable: pane is no longer current.",
      );
    const activeSession = session(pane.agent_session);
    if (
      !activeSession ||
      agentCheckoutSessionFingerprint(activeSession) !== expected
    )
      return unavailable(
        "Agent checkout unavailable: the agent session changed.",
      );
    const report = parseAgentCheckoutTokens(pane.tokens, activeSession);
    if (!report)
      return unavailable(
        "Agent checkout unavailable: this session has not reported a valid checkout.",
      );
    const command = `git -C ${args.shQuote(report.path)} rev-parse --show-toplevel && (git -C ${args.shQuote(report.path)} symbolic-ref --short -q HEAD || printf 'HEAD\\n') && git -C ${args.shQuote(report.path)} rev-parse --git-dir && git -C ${args.shQuote(report.path)} status --porcelain=v1 --branch`;
    const host = args.sshHost();
    const result = await args.runProcessWithCodeTimeout(
      host ? sshCommandArgv(host, command) : ["sh", "-lc", command],
      TIMEOUT_MS,
    );
    if (result.code !== 0)
      return unavailable(
        "Agent checkout unavailable: reported path is not a reachable Git checkout.",
      );
    const parsed = parseAgentCheckoutStatus(result.stdout);
    if (!parsed || !isAbsolute(parsed.checkout_path))
      return unavailable(
        "Agent checkout unavailable: reported path is not a Git checkout.",
      );
    return {
      available: true,
      ...parsed,
      ...(report.reportedPr ? { reported_pr: report.reportedPr } : {}),
    };
  };
}
