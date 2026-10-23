import type {
  PullRequestCheck,
  PullRequestCheckState,
  PullRequestDetail,
  PullRequestReviewer,
} from "../../../shared/pullRequests";
import type { WorkItem } from "../../../shared/worldSources";
import { record } from "./github";

/**
 * Your open pull requests, read in detail: checks on the head, reviewer
 * agents' RESULT lines, changed files and images. Comment text is read here
 * and never sent on; the browser gets only the parsed result. A pull request
 * is read again only when GitHub reports it changed, or after a while (the
 * base branch moves without touching it), and at most a few per refresh.
 */

/** Pull requests per GraphQL request. */
export const DETAIL_BATCH = 10;
/** Pull requests read in detail per refresh; the rest wait for the next one. */
export const DETAIL_PER_REFRESH = 20;
/** Read again after this long even when nothing on it changed. */
export const DETAIL_MAX_AGE_MS = 10 * 60_000;
const MAX_CHECKS = 100;
const MAX_LINE = 200;

export type CachedDetail = {
  stamp: string;
  readAt: number;
  detail: PullRequestDetail;
};

/** What, on the list, says a pull request changed. */
export function detailStamp(item: WorkItem) {
  return [
    item.updatedAt,
    item.headSha,
    item.checks,
    item.mergeable,
    item.draft,
    item.review,
  ].join("|");
}

/** Which of `items` to read now: changed, never read, still running, or old. */
export function detailsDue(
  items: WorkItem[],
  cache: ReadonlyMap<string, CachedDetail>,
  now: number,
): WorkItem[] {
  const due = items
    .filter((item) => item.headSha && item.repo && item.number !== undefined)
    .map((item) => {
      const known = cache.get(item.key);
      const rank = !known
        ? 0
        : known.stamp !== detailStamp(item)
          ? 1
          : item.checks === "pending" || now - known.readAt >= DETAIL_MAX_AGE_MS
            ? 2
            : null;
      return { item, rank, readAt: known?.readAt ?? 0 };
    })
    .filter((entry) => entry.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || a.readAt - b.readAt);
  return due.slice(0, DETAIL_PER_REFRESH).map((entry) => entry.item);
}

const CHECK_FIELDS = (number: number) => `
  ... on CheckRun { name status conclusion completedAt detailsUrl isRequired(pullRequestNumber: ${number}) }
  ... on StatusContext { context state createdAt targetUrl isRequired(pullRequestNumber: ${number}) }`;

/** One request for up to DETAIL_BATCH pull requests. */
export function detailQuery(items: WorkItem[]) {
  return `query {
${items
  .map((item, index) => {
    const [owner, name] = item.repo!.split("/");
    const base = item.pr?.baseRef ?? item.base ?? "main";
    return `  p${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${item.number}) {
      headRefOid body author { login }
      headRef { compare(headRef: ${JSON.stringify(base)}) { aheadBy } }
      files(first: 100) { totalCount nodes { path } }
      commits(last: 100) { nodes { commit { oid committedDate } } }
      latest: commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: ${MAX_CHECKS}) { totalCount nodes { ${CHECK_FIELDS(item.number!)} } } } } } }
      reviews(last: 30) { nodes { author { login } authorAssociation body url submittedAt commit { oid } } }
      comments(last: 50) { nodes { author { login } authorAssociation body url createdAt } }
    }
  }`;
  })
  .join("\n")}
}`;
}

/** The parsed detail for each item of a batch, by key; null for one GitHub didn't answer. */
export function parseDetails(
  items: WorkItem[],
  data: Record<string, unknown>,
): Map<string, PullRequestDetail | null> {
  const result = new Map<string, PullRequestDetail | null>();
  items.forEach((item, index) => {
    const pr = record(record(data[`p${index}`]).pullRequest);
    result.set(item.key, Object.keys(pr).length ? parseDetail(item, pr) : null);
  });
  return result;
}

/** Comments from people with standing in the repository, not passers-by. */
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function parseDetail(
  item: WorkItem,
  pr: Record<string, unknown>,
): PullRequestDetail {
  const head = typeof pr.headRefOid === "string" ? pr.headRefOid : item.headSha;
  const commits = nodes(pr.commits).map((node) => {
    const commit = record(node.commit);
    return {
      oid: typeof commit.oid === "string" ? commit.oid : "",
      at: time(commit.committedDate),
    };
  });
  const author = record(pr.author).login;
  const latest = record(record(nodes(pr.latest).at(-1)).commit);
  const contexts = record(record(latest.statusCheckRollup).contexts);
  const checks = nodes(contexts).map(check).slice(0, MAX_CHECKS);
  const files = record(pr.files);
  const paths = nodes(files)
    .map((node) => node.path)
    .filter((path): path is string => typeof path === "string");
  const allFiles = Number(files.totalCount) <= paths.length;
  const ui = paths.some(uiPath);
  const compare = record(record(pr.headRef).compare);
  const posts: Post[] = [
    ...nodes(pr.reviews).map((node) => ({
      ...node,
      at: time(node.submittedAt),
      commit: record(node.commit).oid,
    })),
    ...nodes(pr.comments).map((node) => ({
      ...node,
      at: time(node.createdAt),
    })),
  ];
  const own = posts.filter((post) => record(post.author).login === author);
  return {
    baseRef: item.base ?? "main",
    behindBy: Number.isSafeInteger(compare.aheadBy)
      ? (compare.aheadBy as number)
      : null,
    checks,
    checksTruncated: Number(contexts.totalCount) > checks.length,
    reviewers: reviewerResults(
      item.number!,
      posts.filter((post) => TRUSTED.has(post.authorAssociation as string)),
      commits,
      head ?? "",
    ),
    uiChange: ui ? true : allFiles ? false : null,
    images:
      countImages(pr.body) +
      own.reduce((sum, post) => sum + countImages(post.body), 0),
  };
}

/** The web app or site, not its tests. */
export function uiPath(path: string) {
  return (
    /^(web\/src|site)\//u.test(path) && !/\.(test|browser)\.[^/]*$/u.test(path)
  );
}

export function countImages(body: unknown) {
  if (typeof body !== "string") return 0;
  return (
    (body.match(/!\[[^\]]*\]\([^)\s]+[^)]*\)/gu)?.length ?? 0) +
    (body.match(/<img\b/giu)?.length ?? 0)
  );
}

function check(node: Record<string, unknown>): PullRequestCheck {
  const run = node.__typename === "CheckRun" || "conclusion" in node;
  const name = String((run ? node.name : node.context) ?? "check").slice(
    0,
    MAX_LINE,
  );
  const url = httpsUrl(run ? node.detailsUrl : node.targetUrl);
  const completedAt = time(run ? node.completedAt : node.createdAt);
  return {
    name,
    state: run ? runState(node) : statusState(node.state),
    required: node.isRequired === true,
    ...(url ? { url } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

function runState(node: Record<string, unknown>): PullRequestCheckState {
  if (node.status !== "COMPLETED") return "pending";
  if (node.conclusion === "SUCCESS") return "pass";
  if (node.conclusion === "SKIPPED" || node.conclusion === "NEUTRAL")
    return "skipped";
  return "fail";
}

function statusState(state: unknown): PullRequestCheckState {
  if (state === "SUCCESS") return "pass";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "fail";
}

type Post = Record<string, unknown> & { at: number; commit?: unknown };

/**
 * Each reviewer's latest result for this pull request. A reviewer's post
 * without a RESULT line counts as a result World can't read. A review names
 * the commit it was given on; a comment's head is the SHA it names, else the
 * newest commit made before it (inferred).
 */
export function reviewerResults(
  number: number,
  posts: Post[],
  commits: { oid: string; at: number }[],
  head: string,
): PullRequestReviewer[] {
  const latest = new Map<string, PullRequestReviewer>();
  for (const post of [...posts].sort((a, b) => a.at - b.at)) {
    if (typeof post.body !== "string") continue;
    const reviewer = reviewerOf(post.body);
    if (!reviewer) continue;
    const line = resultLine(post.body, number);
    // Only GitHub's review metadata or a SHA the text names binds a result
    // to a head; when a commit was made says nothing of when it was pushed.
    const commit =
      (typeof post.commit === "string" && post.commit) ||
      namedCommit(post.body, commits) ||
      null;
    const index = commit
      ? commits.findIndex((entry) => entry.oid === commit)
      : -1;
    latest.set(reviewer, {
      reviewer,
      url: httpsUrl(post.url) ?? "",
      at: post.at,
      // The whole line decides; only what is shown is shortened. Without a
      // RESULT line nothing of the post leaves the service.
      outcome: line ? resultOutcome(line) : "unknown",
      line: line ? bounded(line) : "",
      commit,
      commitsSince:
        commit === head ? 0 : index >= 0 ? commits.length - 1 - index : null,
    });
  }
  return [...latest.values()].sort((a, b) =>
    a.reviewer.localeCompare(b.reviewer, undefined, { numeric: true }),
  );
}

/**
 * A reviewer's own post opens with its name and a separator: `rev2 — …`,
 * `**rev4**: …`, `[rev4 -> sources] …`. An author's reply that mentions a
 * reviewer (`rev2 findings, fixed in …`) does not.
 */
export function reviewerOf(body: string) {
  return (
    /^[\s[*_>#]*(rev\d+)[*_]*\s*(?:—|–|:|->|-\s)/iu
      .exec(body)?.[1]
      ?.toLowerCase() ?? null
  );
}

export function resultLine(body: string, number: number) {
  const match = new RegExp(`RESULT #${number}:\\s*([^\\n]*)`, "u").exec(body);
  return match ? match[1]!.replace(/[*_`]/gu, "").trim() : null;
}

const bounded = (text: string) =>
  [...text.replace(/[*_`]/gu, "").trim()].slice(0, MAX_LINE).join("");

const NUMBER = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Reviewers write results in their own words. Anything still open wins:
 * `1 remaining`, `1 original P2 remains`, `1 P2 open`, `1 new P2`,
 * `2/3 resolved`, `3 findings`, `not confirmed`. Otherwise `3/3 resolved`,
 * `confirmed`, `no new findings` or `0 findings` confirm. Anything else is
 * unknown: World never reads Ready into a phrase it doesn't recognise.
 */
export function resultOutcome(line: string): PullRequestReviewer["outcome"] {
  const counts = (pattern: string) =>
    [...line.matchAll(new RegExp(pattern, "giu"))].map((match) => {
      const word = match[1]!.toLowerCase();
      return WORDS[word] ?? Number(word);
    });
  // A count stands alone: not the second half of `2/3`, nor the 3 in `P1–P3`.
  const lone = `(?<![/\\d])\\b${NUMBER}`;
  // Every fraction counts: `2/2 resolved; 0/1 resolved` is not resolved.
  const fractions = [
    ...line.matchAll(/(\d+)\s*\/\s*(\d+)\b[^,;]*?\bresolved/giu),
  ].map((match) => [Number(match[1]), Number(match[2])] as const);
  const open =
    counts(
      `${lone}\\s+(?:[\\w-]+\\s+){0,3}?(?:remain(?:s|ing)?|open|unresolved|unfixed|outstanding(?!\\s+(?:findings?\\s+)?(?:resolved|fixed|confirmed)))\\b`,
    ).some(Boolean) ||
    counts(`${lone}\\s+new\\b`).some(Boolean) ||
    // `a new P2`, `another new P3`, `new findings`, but not `no new findings`.
    [
      ...line.matchAll(
        /(\b(?:no|zero|0)\s+)?\bnew\s+(?:P\d|findings?|issues?|regressions?)\b/giu,
      ),
    ].some((match) => !match[1]) ||
    // `3 findings`, `one finding`; `all four findings` is a tally, not a count.
    counts(`(?<!\\ball\\s)${lone}\\s+findings?\\b`).some(Boolean) ||
    /\b(?:not|never)\s+(?:yet\s+)?(?:confirmed|resolved|fixed)\b|\bunconfirmed\b/iu.test(
      line,
    ) ||
    fractions.some(([done, total]) => done < total);
  if (open) return "open";
  return fractions.length ||
    /\b(?:confirmed|no (?:new )?findings|0 (?:new )?findings)\b/iu.test(line)
    ? "confirmed"
    : "unknown";
}

function namedCommit(body: string, commits: { oid: string }[]) {
  const named = /\b(?:at|of)\s+`?([0-9a-f]{7,40})\b/iu
    .exec(body)?.[1]
    ?.toLowerCase();
  return named
    ? (commits.find((entry) => entry.oid.startsWith(named))?.oid ?? null)
    : null;
}

function nodes(value: unknown): Record<string, unknown>[] {
  const list = record(value).nodes;
  return Array.isArray(list)
    ? list.map(record).filter((node) => Object.keys(node).length)
    : [];
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

function time(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
