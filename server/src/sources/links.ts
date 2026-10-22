import { isAbsolute } from "node:path";
import type { WorkItem, WorkLink } from "../../../shared/worldSources";
import { sshCommandArgv } from "../bridge/ssh-command";
import {
  agentSessionOf,
  parseAgentCheckoutTokens,
} from "../agent/checkout-context";
import { parseReviewRemote } from "../workspace/pull-request";
import { shQuote } from "../utils/process-utils";
import { record, type RunProcess } from "./github";

/**
 * Links work items to the agent panes working on them. An agent that reported
 * its pull request (herdr-world agent-checkout --pr) is linked to it directly.
 * Otherwise World reads the branch and GitHub remotes of the agent's checkout
 * (its reported path, else its pane or workspace directory) and links the
 * pull request whose head is that branch, and any ticket whose key the branch
 * names. Lookups are bounded, cached and qualified by connection.
 */

export type TopologyConnection = {
  connection_id: string;
  stale: boolean;
  snapshot: {
    workspaces: Record<string, unknown>[];
    panes: Record<string, unknown>[];
  } | null;
};

/** How to run git for a connection's checkouts; null when World cannot. */
export type CheckoutHost =
  | { kind: "local" }
  | { kind: "ssh"; destination: string };

export type Checkout = { branch: string; repos: string[] };

const MAX_LOOKUPS = 32;
const CONCURRENCY = 4;
const LOOKUP_TIMEOUT_MS = 6_000;
const CHECKOUT_TTL_MS = 120_000;
const MAX_PATH = 1_024;
const TICKET_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/gu;

type Candidate = {
  connectionId: string;
  paneId: string;
  path: string | null;
  reportedPr: string | null;
};

export class CheckoutResolver {
  #cache = new Map<string, { at: number; checkout: Checkout | null }>();

  constructor(
    private readonly run: RunProcess,
    private readonly hostOf: (connectionId: string) => CheckoutHost | null,
    private readonly now: () => number = Date.now,
  ) {}

  cached(connectionId: string, path: string): Checkout | null | undefined {
    const entry = this.#cache.get(`${connectionId}\0${path}`);
    return entry && this.now() - entry.at < CHECKOUT_TTL_MS
      ? entry.checkout
      : undefined;
  }

  async resolve(connectionId: string, path: string): Promise<Checkout | null> {
    const known = this.cached(connectionId, path);
    if (known !== undefined) return known;
    const checkout = await this.#read(connectionId, path).catch(() => null);
    this.#cache.set(`${connectionId}\0${path}`, { at: this.now(), checkout });
    if (this.#cache.size > MAX_LOOKUPS * 8) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    return checkout;
  }

  async #read(connectionId: string, path: string): Promise<Checkout | null> {
    const host = this.hostOf(connectionId);
    if (!host) return null;
    const quoted = shQuote(path);
    const command = `GIT_TERMINAL_PROMPT=0 git -C ${quoted} symbolic-ref --quiet --short HEAD && GIT_TERMINAL_PROMPT=0 git -C ${quoted} remote -v`;
    const argv =
      host.kind === "ssh"
        ? sshCommandArgv(host.destination, command)
        : ["sh", "-c", command];
    const result = await this.run(argv, LOOKUP_TIMEOUT_MS);
    if (result.code !== 0) return null;
    return parseCheckout(result.stdout);
  }
}

/** The branch on the first line, then `git remote -v`; GitHub remotes only. */
export function parseCheckout(output: string): Checkout | null {
  const [first, ...rest] = output.split(/\r?\n/u);
  const branch = first?.trim();
  if (!branch) return null;
  const repos = new Set<string>();
  for (const line of rest) {
    const match = line.match(/^(\S+)\s+(.+)\s+\(fetch\)$/u);
    if (!match) continue;
    const remote = parseReviewRemote(match[1]!, match[2]!);
    if (remote?.host === "github.com") repos.add(remote.repository);
  }
  return { branch, repos: [...repos] };
}

/** Agent panes and where their checkout is, at most MAX_LOOKUPS distinct paths. */
export function linkCandidates(connections: TopologyConnection[]): Candidate[] {
  const candidates: Candidate[] = [];
  const paths = new Set<string>();
  for (const connection of connections) {
    if (connection.stale || !connection.snapshot) continue;
    const checkouts = new Map<string, string>();
    for (const workspace of connection.snapshot.workspaces) {
      const id = workspace.workspace_id;
      const path = record(workspace.worktree).checkout_path;
      if (typeof id === "string" && usablePath(path)) checkouts.set(id, path);
    }
    for (const pane of connection.snapshot.panes) {
      const paneId = pane.pane_id;
      if (typeof paneId !== "string" || !paneId) continue;
      if (typeof pane.agent !== "string" || !pane.agent) continue;
      const activeSession = agentSessionOf(pane.agent_session);
      const report = activeSession
        ? parseAgentCheckoutTokens(pane.tokens, activeSession)
        : null;
      const workspacePath =
        typeof pane.workspace_id === "string"
          ? checkouts.get(pane.workspace_id)
          : undefined;
      let path =
        report?.path ??
        (usablePath(pane.cwd) ? pane.cwd : undefined) ??
        workspacePath ??
        null;
      const pathKey = path ? `${connection.connection_id}\0${path}` : null;
      if (pathKey && !paths.has(pathKey)) {
        if (paths.size >= MAX_LOOKUPS) path = null;
        else paths.add(pathKey);
      }
      candidates.push({
        connectionId: connection.connection_id,
        paneId,
        path,
        reportedPr: report?.reportedPr ?? null,
      });
    }
  }
  return candidates;
}

export async function linkWorkItems(
  connections: TopologyConnection[],
  items: readonly WorkItem[],
  resolver: CheckoutResolver,
): Promise<WorkLink[]> {
  const candidates = linkCandidates(connections);
  const pending = [
    ...new Map(
      candidates
        .filter((candidate) => candidate.path)
        .map((candidate) => [
          `${candidate.connectionId}\0${candidate.path}`,
          candidate,
        ]),
    ).values(),
  ];
  // A few lookups at a time, so a slow host cannot hold every other.
  for (let index = 0; index < pending.length; index += CONCURRENCY)
    await Promise.all(
      pending
        .slice(index, index + CONCURRENCY)
        .map(({ connectionId, path }) => resolver.resolve(connectionId, path!)),
    );
  const pullRequests = items.filter((item) => item.kind === "pull_request");
  const byUrl = new Map(pullRequests.map((item) => [item.url, item]));
  const tickets = new Map(
    items
      .filter((item) => item.kind === "ticket")
      .map((item) => [item.ref, item]),
  );
  const links: WorkLink[] = [];
  const seen = new Set<string>();
  const add = (candidate: Candidate, item: WorkItem, via: WorkLink["via"]) => {
    const key = `${candidate.connectionId}\0${candidate.paneId}\0${item.key}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      connectionId: candidate.connectionId,
      paneId: candidate.paneId,
      itemKey: item.key,
      via,
    });
  };
  for (const candidate of candidates) {
    const reported = candidate.reportedPr
      ? byUrl.get(normalizedPrUrl(candidate.reportedPr))
      : undefined;
    if (reported) add(candidate, reported, "reported");
    const checkout = candidate.path
      ? resolver.cached(candidate.connectionId, candidate.path)
      : null;
    if (!checkout) continue;
    // Open pull requests first, so a reused branch links its live one.
    const matches = pullRequests
      .filter(
        (item) =>
          item.branch === checkout.branch &&
          checkout.repos.some(
            (repo) => repo === item.repo || repo === item.headRepo,
          ),
      )
      .sort(
        (a, b) =>
          Number(a.lane === "merged") - Number(b.lane === "merged") ||
          b.updatedAt - a.updatedAt,
      );
    if (matches[0] && !reported) add(candidate, matches[0], "branch");
    for (const [, key] of checkout.branch.toUpperCase().matchAll(TICKET_KEY)) {
      const ticket = tickets.get(key!);
      if (ticket) add(candidate, ticket, "branch");
    }
  }
  return links;
}

function usablePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PATH &&
    isAbsolute(value) &&
    !/[\0\r\n]/u.test(value)
  );
}

function normalizedPrUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return value;
  }
}
