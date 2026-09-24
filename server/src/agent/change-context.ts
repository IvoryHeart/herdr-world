import { basename } from "node:path";
import { sshCommandArgv } from "../bridge/ssh-command";
import type { RunProcessWithCodeTimeout } from "../workspace/file-types";
import { GIT_DIFF_TIMEOUT_MS } from "../workspace/file-constants";
import {
  readDiffFile,
  readDiffSummary,
  type LastStepBaselineStore,
} from "../workspace/git-diff";
import type { HerdrCall } from "./session-types";

export type AgentChangeResolutionSource =
  | "reported-checkout"
  | "foreground-cwd"
  | "cwd"
  | "unresolved";

export type AgentChangeContext = {
  version: 1;
  pane_id: string;
  workspace_id: string;
  agent: string;
  display_agent: string;
  agent_status: string;
  status: "resolved" | "unavailable";
  source: AgentChangeResolutionSource;
  checkout_path: string;
  root: string;
  repo_name: string;
  branch: string;
  detail: string;
};

type AgentChangeCandidate = {
  source: Exclude<AgentChangeResolutionSource, "unresolved">;
  path: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueCandidates(candidates: AgentChangeCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.path || seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

/**
 * Produce only paths reported by the selected agent. Workspace metadata is
 * deliberately not an input: it cannot prove which checkout the agent owns.
 */
export function agentChangeCandidates(
  agentInfo: Record<string, unknown> | null,
): AgentChangeCandidate[] {
  if (!agentInfo) return [];
  const worktree = record(agentInfo.worktree);
  return uniqueCandidates([
    ...[
      text(agentInfo.checkout_path),
      text(agentInfo.worktree_path),
      text(agentInfo.agent_checkout_path),
      text(agentInfo.agent_worktree_path),
      text(worktree?.checkout_path),
      text(worktree?.path),
    ].map((path) => ({ source: "reported-checkout" as const, path })),
    {
      source: "foreground-cwd",
      path: text(agentInfo.foreground_cwd),
    },
    { source: "cwd", path: text(agentInfo.cwd) },
  ]);
}

function agentInfoFromResult(result: unknown) {
  const value = record(result);
  return record(value?.agent) ?? value;
}

function commandArgs(host: string | undefined, command: string): string[] {
  return host ? sshCommandArgv(host, command) : ["sh", "-lc", command];
}

async function runGitCommand({
  root,
  host,
  shQuote,
  runProcessWithCodeTimeout,
  command,
}: {
  root: string;
  host?: string;
  shQuote: (value: string) => string;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
  command: string;
}) {
  return runProcessWithCodeTimeout(
    commandArgs(host, `git -C ${shQuote(root)} ${command}`),
    GIT_DIFF_TIMEOUT_MS,
  );
}

function unavailableContext(
  paneId: string,
  agentInfo: Record<string, unknown> | null,
  detail: string,
): AgentChangeContext {
  const agent = text(agentInfo?.agent) || "agent";
  const workspaceId = text(agentInfo?.workspace_id);
  const displayAgent =
    text(agentInfo?.display_agent) || text(agentInfo?.agent_name) || agent;
  return {
    version: 1,
    pane_id: paneId,
    workspace_id: workspaceId,
    agent,
    display_agent: displayAgent,
    agent_status: text(agentInfo?.agent_status) || text(agentInfo?.status),
    status: "unavailable",
    source: "unresolved",
    checkout_path: "",
    root: "",
    repo_name: "",
    branch: "",
    detail,
  };
}

export async function resolveAgentChangeContext({
  paneId,
  agentInfo,
  host,
  shQuote,
  runProcessWithCodeTimeout,
}: {
  paneId: string;
  agentInfo: Record<string, unknown> | null;
  host?: string;
  shQuote: (value: string) => string;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
}): Promise<AgentChangeContext> {
  if (!agentInfo) {
    return unavailableContext(
      paneId,
      null,
      "Herdr did not return metadata for this agent pane.",
    );
  }
  const candidates = agentChangeCandidates(agentInfo);
  if (!candidates.length) {
    return unavailableContext(
      paneId,
      agentInfo,
      "The agent did not report a checkout or working directory.",
    );
  }

  let lastError = "The reported path is not a Git checkout.";
  for (const candidate of candidates) {
    const rootResult = await runProcessWithCodeTimeout(
      host
        ? sshCommandArgv(
            host,
            `git -C ${shQuote(candidate.path)} rev-parse --show-toplevel`,
          )
        : ["git", "-C", candidate.path, "rev-parse", "--show-toplevel"],
      GIT_DIFF_TIMEOUT_MS,
    );
    if (rootResult.code !== 0 || !rootResult.stdout.trim()) {
      lastError = (rootResult.stderr || rootResult.stdout || lastError).trim();
      continue;
    }
    const root = rootResult.stdout.trim();
    const branchResult = await runGitCommand({
      root,
      host,
      shQuote,
      runProcessWithCodeTimeout,
      command: "branch --show-current",
    });
    const agent = text(agentInfo.agent) || "agent";
    const displayAgent =
      text(agentInfo.display_agent) || text(agentInfo.agent_name) || agent;
    return {
      version: 1,
      pane_id: paneId,
      workspace_id: text(agentInfo.workspace_id),
      agent,
      display_agent: displayAgent,
      agent_status: text(agentInfo.agent_status) || text(agentInfo.status),
      status: "resolved",
      source: candidate.source,
      checkout_path: candidate.path,
      root,
      repo_name: basename(root),
      branch: branchResult.code === 0 ? branchResult.stdout.trim() : "",
      detail: "",
    };
  }

  return unavailableContext(
    paneId,
    agentInfo,
    `Agent checkout unavailable: ${lastError.slice(0, 500)}`,
  );
}

export function createAgentChangeHandlers({
  herdrCall,
  sshHost,
  runProcessWithCodeTimeout,
  shQuote,
  lastStepBaselines,
}: {
  herdrCall: HerdrCall;
  sshHost: () => string | undefined;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
  shQuote: (value: string) => string;
  lastStepBaselines?: LastStepBaselineStore;
}) {
  async function resolve(params: Record<string, unknown>) {
    const paneId = text(params.pane_id);
    if (!paneId) throw new Error("agent_changes requires pane_id");
    const result = await herdrCall("agent.get", { target: paneId });
    return resolveAgentChangeContext({
      paneId,
      agentInfo: agentInfoFromResult(result),
      host: sshHost(),
      shQuote,
      runProcessWithCodeTimeout,
    });
  }

  async function context(params: Record<string, unknown>) {
    return resolve(params);
  }

  async function summary(params: Record<string, unknown>) {
    const target = await resolve(params);
    if (target.status !== "resolved") throw new Error(target.detail);
    const result = await readDiffSummary({
      workspaceId: target.workspace_id || target.pane_id,
      workspace: { label: target.repo_name },
      root: target.root,
      params,
      host: sshHost(),
      shQuote,
      runProcessWithCodeTimeout,
      lastStepBaselines,
    });
    return { ...result, pane_id: target.pane_id, agent_context: target };
  }

  async function file(params: Record<string, unknown>) {
    const target = await resolve(params);
    if (target.status !== "resolved") throw new Error(target.detail);
    const result = await readDiffFile({
      workspaceId: target.workspace_id || target.pane_id,
      root: target.root,
      params,
      host: sshHost(),
      shQuote,
      runProcessWithCodeTimeout,
      lastStepBaselines,
    });
    return { ...result, pane_id: target.pane_id, agent_context: target };
  }

  return { context, summary, file };
}
