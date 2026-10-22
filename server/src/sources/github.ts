import {
  pullRequestLane,
  type WorkChecks,
  type WorkItem,
  type WorkReview,
  type WorkRole,
} from "../../../shared/worldSources";

/**
 * GitHub through the service user's `gh` sign-in: open pull requests the user
 * authored, was asked to review or is assigned, recently merged ones, and
 * assigned issues. One bounded GraphQL request per refresh.
 */

export type ProcessResult = { code: number; stdout: string; stderr: string };
export type RunProcess = (
  argv: string[],
  timeoutMs: number,
) => Promise<ProcessResult>;

export type SourceRefresh =
  | { ok: true; items: WorkItem[] }
  | { ok: false; state: "not_connected" | "error"; detail: string };

const TIMEOUT_MS = 20_000;
const PAGE = 50;
const MERGED_PAGE = 20;
const MERGED_DAYS = 7;
const MAX_TITLE = 300;
const MAX_OUTPUT = 4 * 1024 * 1024;

export const GITHUB_NOT_INSTALLED =
  "Install the GitHub CLI (gh) for the user that runs World, then sign in with gh auth login.";
export const GITHUB_SIGNED_OUT =
  "Sign in with gh auth login as the user that runs World, then refresh.";
const GITHUB_FAILED =
  "GitHub did not answer. World keeps the last pull requests and tries again shortly.";

const PR_FIELDS = `
  number title url isDraft state updatedAt headRefName reviewDecision mergeable
  repository { nameWithOwner }
  headRepository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

export function githubQuery(now: number) {
  const since = new Date(now - MERGED_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const search = (alias: string, query: string, first: number, body: string) =>
    `${alias}: search(type: ISSUE, first: ${first}, query: ${JSON.stringify(query)}) { nodes { ${body} } }`;
  const pr = `... on PullRequest { ${PR_FIELDS} }`;
  const issue = `... on Issue { number title url updatedAt repository { nameWithOwner } }`;
  return `query {
  ${search("authored", "is:pr is:open author:@me archived:false", PAGE, pr)}
  ${search("reviewing", "is:pr is:open review-requested:@me archived:false", PAGE, pr)}
  ${search("assigned", "is:pr is:open assignee:@me archived:false", PAGE, pr)}
  ${search("merged", `is:pr is:merged author:@me merged:>=${since}`, MERGED_PAGE, pr)}
  ${search("issues", "is:issue is:open assignee:@me archived:false", PAGE, issue)}
}`;
}

export async function refreshGitHub(
  run: RunProcess,
  now: number,
): Promise<SourceRefresh> {
  let auth: ProcessResult;
  try {
    auth = await run(
      ["gh", "auth", "status", "--hostname", "github.com"],
      TIMEOUT_MS,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        ok: false,
        state: "not_connected",
        detail: GITHUB_NOT_INSTALLED,
      };
    return { ok: false, state: "error", detail: GITHUB_FAILED };
  }
  if (auth.code === 127)
    return { ok: false, state: "not_connected", detail: GITHUB_NOT_INSTALLED };
  if (auth.code !== 0)
    return { ok: false, state: "not_connected", detail: GITHUB_SIGNED_OUT };
  let result: ProcessResult;
  try {
    result = await run(
      ["gh", "api", "graphql", "-f", `query=${githubQuery(now)}`],
      TIMEOUT_MS,
    );
  } catch {
    return { ok: false, state: "error", detail: GITHUB_FAILED };
  }
  if (result.code !== 0 || result.stdout.length > MAX_OUTPUT)
    return { ok: false, state: "error", detail: GITHUB_FAILED };
  try {
    return { ok: true, items: parseGitHubResponse(JSON.parse(result.stdout)) };
  } catch {
    return { ok: false, state: "error", detail: GITHUB_FAILED };
  }
}

const ROLE_OF: Record<string, WorkRole> = {
  authored: "author",
  reviewing: "reviewer",
  assigned: "assignee",
  merged: "author",
};

/** Merge the searches into one record per pull request or issue. */
export function parseGitHubResponse(value: unknown): WorkItem[] {
  const data = record(record(value).data);
  if (!Object.keys(data).length) throw new Error("GitHub response has no data");
  const items = new Map<string, WorkItem>();
  for (const alias of ["authored", "reviewing", "assigned", "merged"]) {
    for (const node of nodes(data[alias])) {
      const item = pullRequestItem(node);
      if (!item) continue;
      const known = items.get(item.key);
      const role = ROLE_OF[alias]!;
      if (known) {
        if (!known.roles.includes(role)) known.roles.push(role);
      } else items.set(item.key, { ...item, roles: [role] });
    }
  }
  for (const node of nodes(data.issues)) {
    const item = issueItem(node);
    if (item && !items.has(item.key)) items.set(item.key, item);
  }
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function pullRequestItem(node: Record<string, unknown>): WorkItem | null {
  const repo = repoName(node.repository);
  const number = node.number;
  const url = httpsUrl(node.url);
  if (!repo || !Number.isSafeInteger(number) || !url) return null;
  const merged = node.state === "MERGED";
  if (!merged && node.state !== "OPEN") return null;
  const checks = rollup(node.commits);
  const review = reviewOf(node.reviewDecision);
  const mergeable =
    node.mergeable === "MERGEABLE"
      ? "mergeable"
      : node.mergeable === "CONFLICTING"
        ? "conflicting"
        : "unknown";
  const draft = node.isDraft === true;
  const headRepo = repoName(node.headRepository);
  return {
    key: `github:pr:${repo}#${number}`,
    source: "github",
    kind: "pull_request",
    ref: `${repo}#${number}`,
    title: title(node.title),
    url,
    lane: pullRequestLane({ merged, draft, checks, review, mergeable }),
    status: merged ? "merged" : draft ? "draft" : "open",
    roles: [],
    updatedAt: time(node.updatedAt),
    number: number as number,
    repo,
    ...(typeof node.headRefName === "string" && node.headRefName
      ? { branch: node.headRefName }
      : {}),
    ...(headRepo && headRepo !== repo ? { headRepo } : {}),
    draft,
    checks,
    review,
    mergeable,
  };
}

function issueItem(node: Record<string, unknown>): WorkItem | null {
  const repo = repoName(node.repository);
  const number = node.number;
  const url = httpsUrl(node.url);
  if (!repo || !Number.isSafeInteger(number) || !url) return null;
  return {
    key: `github:issue:${repo}#${number}`,
    source: "github",
    kind: "issue",
    ref: `${repo}#${number}`,
    title: title(node.title),
    url,
    lane: "todo",
    status: "open",
    roles: ["assignee"],
    updatedAt: time(node.updatedAt),
    number: number as number,
    repo,
  };
}

function rollup(commits: unknown): WorkChecks {
  const last = nodes(commits).at(-1);
  const state = record(record(record(last?.commit).statusCheckRollup)).state;
  if (state === "SUCCESS") return "pass";
  if (state === "FAILURE" || state === "ERROR") return "fail";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "none";
}

function reviewOf(value: unknown): WorkReview {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes_requested";
  if (value === "REVIEW_REQUIRED") return "review_required";
  return "none";
}

function nodes(value: unknown): Record<string, unknown>[] {
  const list = record(value).nodes;
  return Array.isArray(list)
    ? list.map(record).filter((node) => Object.keys(node).length)
    : [];
}

function repoName(value: unknown) {
  const name = record(value).nameWithOwner;
  return typeof name === "string" && /^[\w.-]+\/[\w.-]+$/u.test(name)
    ? name
    : null;
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function title(value: unknown) {
  return typeof value === "string"
    ? [...value.trim()].slice(0, MAX_TITLE).join("")
    : "";
}

function time(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
