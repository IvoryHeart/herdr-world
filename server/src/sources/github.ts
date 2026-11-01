import {
  DETAIL_BATCH,
  DETAIL_MAX_AGE_MS,
  detailQuery,
  detailsDue,
  detailStamp,
  parseDetails,
  type CachedDetail,
} from "./pullRequestDetail";
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
 * assigned issues. One bounded GraphQL request per refresh, plus a page of
 * 100 for each further hundred merged in the window.
 */

export type ProcessResult = { code: number; stdout: string; stderr: string };
export type RunProcess = (
  argv: string[],
  timeoutMs: number,
) => Promise<ProcessResult>;

export type SourceRefresh =
  | { ok: true; items: WorkItem[]; pullRequestsComplete?: boolean }
  | { ok: false; state: "not_connected" | "error"; detail: string };

const TIMEOUT_MS = 20_000;
/** One refresh, every page included. */
const DEADLINE_MS = 60_000;
const PAGE = 50;
const MERGED_PAGE = 100;
/** GitHub's search answers at most 1,000 results. */
const MERGED_PAGES = 10;
export const DEFAULT_MERGED_DAYS = 7;
export const MAX_MERGED_DAYS = 90;
const MAX_TITLE = 300;
const MAX_OUTPUT = 4 * 1024 * 1024;

export const GITHUB_NOT_INSTALLED =
  "Install the GitHub CLI (gh) for the user that runs World, then sign in with gh auth login.";
export const GITHUB_SIGNED_OUT =
  "Sign in with gh auth login as the user that runs World, then refresh.";
const GITHUB_FAILED =
  "GitHub did not answer. World keeps the last pull requests and tries again shortly.";

/** Contexts read with each PR's rollup, to leave the crew's marks out of it. */
const ROLLUP_CONTEXTS = 100;

export const PR_FIELDS = `
  number title url isDraft state updatedAt mergedAt headRefName headRefOid baseRefName reviewDecision mergeable
  repository { nameWithOwner }
  headRepository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: ${ROLLUP_CONTEXTS}) { totalCount nodes { __typename ... on CheckRun { status conclusion } ... on StatusContext { context state } } } } } } }`;

export function normalizeMergedDays(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_MERGED_DAYS
  )
    throw new Error(
      `Merged pull requests window must be 1 to ${MAX_MERGED_DAYS} days`,
    );
  return value as number;
}

const search = (alias: string, query: string, first: number, body: string) =>
  `${alias}: search(type: ISSUE, first: ${first}, query: ${JSON.stringify(query)}) { ${body} }`;
const PR_NODES = `nodes { ... on PullRequest { ${PR_FIELDS} } }`;
const MERGED_NODES = `pageInfo { hasNextPage endCursor } ${PR_NODES}`;
const OPEN_NODES = `pageInfo { hasNextPage } ${PR_NODES}`;

function mergedQuery(now: number, days: number) {
  const since = new Date(now - days * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z");
  return `is:pr is:merged author:@me merged:>=${since}`;
}

export function githubQuery(now: number, mergedDays = DEFAULT_MERGED_DAYS) {
  const issue = `nodes { ... on Issue { number title url updatedAt repository { nameWithOwner } } }`;
  return `query {
  ${search("authored", "is:pr is:open author:@me archived:false", PAGE, OPEN_NODES)}
  ${search("reviewing", "is:pr is:open review-requested:@me archived:false", PAGE, OPEN_NODES)}
  ${search("assigned", "is:pr is:open assignee:@me archived:false", PAGE, OPEN_NODES)}
  ${search("merged", mergedQuery(now, mergedDays), MERGED_PAGE, MERGED_NODES)}
  ${search("issues", "is:issue is:open assignee:@me archived:false", PAGE, issue)}
}`;
}

/** The next hundred merged pull requests after `cursor`. */
export function mergedPageQuery(
  now: number,
  mergedDays: number,
  cursor: string,
) {
  return `query {
  ${search(
    "merged",
    mergedQuery(now, mergedDays),
    MERGED_PAGE,
    MERGED_NODES,
  ).replace("first: ", `after: ${JSON.stringify(cursor)}, first: `)}
}`;
}

export async function refreshGitHub(
  run: RunProcess,
  now: number,
  mergedDays = DEFAULT_MERGED_DAYS,
  clock: () => number = Date.now,
  /** Your open pull requests read in detail, kept between refreshes. */
  details: Map<string, CachedDetail> = new Map(),
): Promise<SourceRefresh> {
  const deadline = clock() + DEADLINE_MS;
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
  const query = async (text: string) => {
    const remaining = Math.min(TIMEOUT_MS, deadline - clock());
    if (remaining <= 0) throw new Error("GitHub refresh ran out of time");
    const result = await run(
      ["gh", "api", "graphql", "-f", `query=${text}`],
      remaining,
    );
    if (result.code !== 0 || result.stdout.length > MAX_OUTPUT)
      throw new Error("GitHub request failed");
    const response = record(JSON.parse(result.stdout));
    if (Array.isArray(response.errors) && response.errors.length)
      throw new Error("GitHub returned a partial response");
    return record(response.data);
  };
  try {
    const data = await query(githubQuery(now, mergedDays));
    // Every pull request merged in the window, a hundred at a time. A
    // failed page fails the refresh, so the last successful list stays.
    const merged = [...nodes(data.merged)];
    let mergedRowsKnown = Array.isArray(record(data.merged).nodes);
    let page = record(record(data.merged).pageInfo);
    for (
      let pages = 1;
      pages < MERGED_PAGES && page.hasNextPage === true;
      pages++
    ) {
      if (typeof page.endCursor !== "string" || !page.endCursor) break;
      const next = record(
        (await query(mergedPageQuery(now, mergedDays, page.endCursor))).merged,
      );
      mergedRowsKnown &&= Array.isArray(next.nodes);
      merged.push(...nodes(next));
      page = record(next.pageInfo);
    }
    const items = parseGitHubResponse({
      data: { ...data, merged: { nodes: merged } },
    });
    await readDetails(items, details, query, now);
    const complete =
      mergedRowsKnown &&
      page.hasNextPage === false &&
      ["authored", "reviewing", "assigned"].every(
        (alias) =>
          Array.isArray(record(data[alias]).nodes) &&
          record(record(data[alias]).pageInfo).hasNextPage === false,
      );
    return { ok: true, items, pullRequestsComplete: complete };
  } catch {
    return { ok: false, state: "error", detail: GITHUB_FAILED };
  }
}

/**
 * Read your open pull requests in detail where due, then attach each detail
 * that still describes the pull request. A failed batch retains matching
 * display evidence with stale health; it never refreshes its authority.
 */
async function readDetails(
  items: WorkItem[],
  cache: Map<string, CachedDetail>,
  query: (text: string) => Promise<Record<string, unknown>>,
  now: number,
) {
  const own = items.filter(
    (item) =>
      item.kind === "pull_request" &&
      item.lane !== "merged" &&
      item.roles.includes("author"),
  );
  const keys = new Set(own.map((item) => item.key));
  for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
  const due = detailsDue(own, cache, now);
  const failed = (item: WorkItem) => {
    const known = cache.get(item.key);
    if (known) cache.set(item.key, { ...known, failed: true });
  };
  for (let index = 0; index < due.length; index += DETAIL_BATCH) {
    const batch = due.slice(index, index + DETAIL_BATCH);
    let parsed: ReturnType<typeof parseDetails>;
    try {
      parsed = parseDetails(batch, await query(detailQuery(batch)));
    } catch {
      batch.forEach(failed);
      break;
    }
    for (const item of batch) {
      const detail = parsed.get(item.key);
      if (detail)
        cache.set(item.key, { stamp: detailStamp(item), readAt: now, detail });
      else failed(item);
    }
  }
  for (const item of own) {
    const known = cache.get(item.key);
    const matching = known?.stamp === detailStamp(item) ? known : undefined;
    if (matching) item.pr = matching.detail;
    item.prObservation = {
      source: "github",
      headSha: item.headSha ?? "",
      state: matching
        ? !matching.failed &&
          now >= matching.readAt &&
          now - matching.readAt < DETAIL_MAX_AGE_MS
          ? "fresh"
          : "stale"
        : "unavailable",
      readAt: matching?.readAt ?? null,
      expiresAt: matching ? matching.readAt + DETAIL_MAX_AGE_MS : null,
    };
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
    ...(merged && time(node.mergedAt)
      ? { finishedAt: time(node.mergedAt) }
      : {}),
    number: number as number,
    repo,
    // A branch whose head repository is gone (a deleted fork) cannot be
    // attributed to any checkout.
    ...(headRepo && typeof node.headRefName === "string" && node.headRefName
      ? { branch: node.headRefName }
      : {}),
    ...(headRepo ? { headRepo } : {}),
    draft,
    checks,
    review,
    mergeable,
    ...(!merged && typeof node.baseRefName === "string" && node.baseRefName
      ? { base: node.baseRefName }
      : {}),
    ...(!merged &&
    typeof node.headRefOid === "string" &&
    /^[0-9a-f]{40}$/u.test(node.headRefOid)
      ? { headSha: node.headRefOid }
      : {}),
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

/**
 * A `crew/…` commit status: the crew watcher's mark on a head, which reports
 * on the checks and never counts as one (see docs/agent-development.md).
 */
export function crewMark(node: Record<string, unknown>) {
  return (
    node.__typename !== "CheckRun" &&
    !("conclusion" in node) &&
    typeof node.context === "string" &&
    node.context.startsWith("crew/")
  );
}

/**
 * The head's checks, as GitHub's combined state, except that the crew's own
 * marks don't count: when a complete read of the contexts holds any, the
 * state comes from the others. An incomplete read keeps GitHub's state.
 */
function rollup(commits: unknown): WorkChecks {
  const last = nodes(commits).at(-1);
  const summary = record(record(last?.commit).statusCheckRollup);
  const contexts = record(summary.contexts);
  const all = nodes(contexts);
  const own = all.filter(crewMark);
  if (
    own.length &&
    summary.state !== "EXPECTED" &&
    Number(contexts.totalCount) === all.length
  ) {
    const states = all
      .filter((node) => !crewMark(node))
      .map((node) =>
        node.__typename === "CheckRun"
          ? node.status !== "COMPLETED"
            ? "PENDING"
            : ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(
                  String(node.conclusion),
                )
              ? "SUCCESS"
              : "FAILURE"
          : String(node.state),
      );
    if (states.some((state) => state === "FAILURE" || state === "ERROR"))
      return "fail";
    if (states.some((state) => state === "PENDING" || state === "EXPECTED"))
      return "pending";
    return states.length ? "pass" : "none";
  }
  const state = summary.state;
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
