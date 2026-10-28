import type {
  PullRequestCheck,
  PullRequestCheckState,
  PullRequestDetail,
  PullRequestReviewer,
} from "../../../shared/pullRequests";
import type { WorkItem } from "../../../shared/worldSources";
import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../shared/pullRequestFreshness";
import { crewMark, record } from "./github";

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
export const DETAIL_MAX_AGE_MS = PULL_REQUEST_DETAIL_MAX_AGE_MS;
const MAX_CHECKS = 100;
const MAX_LINE = 200;

export type CachedDetail = {
  stamp: string;
  readAt: number;
  detail: PullRequestDetail;
  failed?: boolean;
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
    item.base,
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
          : known.failed ||
              item.checks === "pending" ||
              now < known.readAt ||
              now - known.readAt >= DETAIL_MAX_AGE_MS
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
      reviews(last: 30) { nodes { id author { login } authorAssociation body url submittedAt commit { oid } } }
      comments(last: 50) { nodes { id author { login } authorAssociation body url createdAt } }
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
    result.set(
      item.key,
      completeDetail(item, pr) ? parseDetail(item, pr) : null,
    );
  });
  return result;
}

/** Missing/partial fields or a head that moved mid-read never refresh authority. */
function completeDetail(item: WorkItem, pr: Record<string, unknown>) {
  const collection = (value: unknown) => Array.isArray(record(value).nodes);
  const files = record(pr.files);
  const latest = record(nodes(pr.latest).at(-1)?.commit);
  const rollup = latest.statusCheckRollup;
  const contexts = record(record(rollup).contexts);
  return (
    pr.headRefOid === item.headSha &&
    typeof pr.body === "string" &&
    typeof record(pr.author).login === "string" &&
    (pr.headRef === null || Object.hasOwn(record(pr.headRef), "compare")) &&
    collection(files) &&
    Number.isSafeInteger(files.totalCount) &&
    Number(files.totalCount) >= 0 &&
    nodes(files).every((file) => typeof file.path === "string") &&
    collection(pr.commits) &&
    nodes(pr.commits).some(
      (node) => record(node.commit).oid === item.headSha,
    ) &&
    latest.oid === item.headSha &&
    (rollup === null ||
      (collection(contexts) && Number.isSafeInteger(contexts.totalCount))) &&
    collection(pr.reviews) &&
    collection(pr.comments)
  );
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
  // The crew watcher's commit statuses mark a head for the owner; they
  // report on the checks, so they never count as one.
  const checks = nodes(contexts)
    .filter((node) => !crewMark(node))
    .map(check)
    .slice(0, MAX_CHECKS);
  const files = record(pr.files);
  const paths = nodes(files)
    .map((node) => node.path)
    .filter((path): path is string => typeof path === "string");
  const allFiles = Number(files.totalCount) <= paths.length;
  const ui = paths.some(uiPath);
  const compare = record(record(pr.headRef).compare);
  const posts = postsOf(pr);
  const own = posts.filter((post) => record(post.author).login === author);
  return {
    baseRef: item.base ?? "main",
    behindBy: Number.isSafeInteger(compare.aheadBy)
      ? (compare.aheadBy as number)
      : null,
    checks,
    checksTruncated:
      Number(contexts.totalCount) >
      Math.min(nodes(contexts).length, MAX_CHECKS),
    reviewers: reviewerResults(
      item.number!,
      trustedPosts(posts),
      commits,
      head ?? "",
    ),
    uiChange: ui ? true : allFiles ? false : null,
    images:
      countImages(pr.body) +
      own.reduce((sum, post) => sum + countImages(post.body), 0),
  };
}

/** Formal reviews and comments as dated posts; reviews carry their commit. */
export function postsOf(pr: Record<string, unknown>): Post[] {
  return [
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
}

export function trustedPosts(posts: Post[]) {
  return posts.filter((post) => TRUSTED.has(post.authorAssociation as string));
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

export type Post = Record<string, unknown> & { at: number; commit?: unknown };

/**
 * Latest explicit sender claim per reviewer, plus source-keyed unattributed
 * RESULT posts. Claims are not verified identities: a shared login supplies
 * no crew name. Only review metadata or explicit, unambiguous SHA text binds
 * evidence to a head; timestamps order posts, never establish that binding.
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
    const body = unquoted(post.body);
    const reviewer = reviewerOf(body);
    const line = resultLine(body, number);
    // A result for another PR must not replace this PR's review evidence.
    if (line === null && /\bRESULT #\d+:/u.test(body)) continue;
    if (!reviewer && line === null) continue;
    const url = httpsUrl(post.url) ?? "";
    const sourceId = typeof post.id === "string" && post.id ? post.id : url;
    const binding = reviewedCommit(post.commit, body, commits, head);
    const commit = binding.commit;
    const index = commit
      ? commits.findIndex((entry) => entry.oid === commit)
      : -1;
    latest.set(reviewer ? `reviewer:${reviewer}` : `source:${sourceId}`, {
      reviewer,
      sourceId,
      url,
      at: post.at,
      outcome:
        reviewer && !binding.conflict && line !== null
          ? resultOutcome(line)
          : "unknown",
      line: line ? bounded(line) : "",
      commit,
      commitsSince:
        commit === head ? 0 : index >= 0 ? commits.length - 1 - index : null,
    });
  }
  return [...latest.values()].sort((a, b) =>
    (a.reviewer ?? "").localeCompare(b.reviewer ?? "", undefined, {
      numeric: true,
    }),
  );
}

/** Quoted replies and fenced examples are not the sender's own evidence. */
function unquoted(body: string) {
  let fence: string | null = null;
  return body
    .split(/\r?\n/u)
    .filter((line) => {
      if (/^\s*>/u.test(line)) return false;
      const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = null;
        return false;
      }
      return !fence;
    })
    .join("\n");
}

/**
 * Explicit sender claims only, never a login or a mention in an author reply.
 * Named seats (`rev-opus`) count only on a `Reviewer:` line: as a header they
 * would read git words such as `rev-parse:` as reviewers.
 */
export function reviewerOf(body: string) {
  const text = unquoted(body).replace(/[*_]/gu, "");
  const claims = new Set<string>();
  for (const match of text.matchAll(
    /^\s*(?:#{1,6}\s+)?[*_]*Reviewer[*_]*\s*:\s*[*_`]*(rev(?:\d+|-[a-z][a-z0-9]*))[*_`]*\s*$/gimu,
  )) {
    claims.add(match[1]!.toLowerCase());
  }
  const header =
    /^[\s[*_#]*(rev\d+)[*_]*(?:\s*\([^\n()]{1,80}\))?\s*(?:—|–|:|->|-\s|(?:(?:combined|refreshed|fix|final)\s+)?(?:review|confirmation)\b)/iu.exec(
      text,
    )?.[1];
  if (header) claims.add(header.toLowerCase());
  return claims.size === 1 ? [...claims][0]! : null;
}

export function resultLine(body: string, number: number) {
  const text = unquoted(body);
  const pattern = new RegExp(
    `^\\s*(?:[*_#]+\\s*)?RESULT #${number}:([^\\n]*)`,
    "gmu",
  );
  const lines = [...text.matchAll(pattern)].map((match) => match[1]!);
  const first = text.trimStart().split("\n")[0]!;
  // Preserve the historical `rev2 — RESULT #N: …` sender-header form.
  if (reviewerOf(first)) {
    const inline = new RegExp(`\\bRESULT #${number}:([^\\n]*)`, "u").exec(
      first,
    );
    if (inline) lines.unshift(inline[1]!);
  }
  return lines.length
    ? lines.map((line) => line.replace(/[*_`]/gu, "").trim()).join("; ")
    : null;
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
    counts(`(?<!\\ball\\s)${lone}\\s+(?:P[1-3]\\s+)?findings?\\b`).some(
      Boolean,
    ) ||
    /\b(?:not|never)\s+(?:yet\s+)?(?:confirmed|resolved|fixed)\b|\bunconfirmed\b/iu.test(
      line,
    ) ||
    fractions.some(([done, total]) => done < total);
  if (open) return "open";
  if (
    /\b(?:pending|awaiting|uncertain|unknown|unverified|incomplete|tbd)\b|\b(?:needs?|requires?)\s+(?:another|further|follow[ -]?up)\b|\b(?:cannot|can't|unable to)\s+(?:confirm|verify|review)\b|\bnot\s+(?:yet\s+)?(?:reviewed|verified|checked)\b/iu.test(
      line,
    )
  )
    return "unknown";
  if (fractions.some(([done, total]) => done !== total)) return "unknown";
  const explicitClear =
    /\b(?:confirmed|no (?:new )?findings|0 (?:new )?findings|0 new)\b/iu.test(
      line,
    );
  // A resolved fraction alone cannot turn an unrecognised remainder into clear.
  const verdict = line.split(/[.!?](?:\s|$)/u)[0]!;
  const remainder = verdict
    .replace(/(\d+)\s*\/\s*(\d+)\b[^,;]*?\bresolved/giu, "")
    .replace(
      /\b(?:no|0)\s+new(?:\s+(?:findings?|issues?|regressions?))?\b|\b(?:no|0)\s+findings?\b|\bconfirmed\b/giu,
      "",
    )
    .replace(/[\s.,;]+/gu, "");
  if (fractions.length) return remainder ? "unknown" : "confirmed";
  return explicitClear ? "confirmed" : "unknown";
}

/** Conflicting claims and ambiguous short SHAs fail closed, even with metadata. */
function reviewedCommit(
  metadata: unknown,
  body: string,
  commits: { oid: string }[],
  head: string,
) {
  const claims = new Set<string>();
  if (typeof metadata === "string" && /^[0-9a-f]{40}$/iu.test(metadata))
    claims.add(metadata.toLowerCase());
  const known = new Set([...commits.map((entry) => entry.oid), head]);
  // Findings may compare historical RED/GREEN commits. Only declarations or
  // explicit reviewer headers claim which head this review actually examined.
  const declarations = body
    .replace(/[*_]/gu, "")
    .split(/\r?\n/u)
    .filter(
      (line) =>
        /^\s*(?:Reviewed (?:commit|head)\s*:|(?:reviewed|confirmed)\s+(?:the\s+)?(?:(?:current|published|exact|final)\s+)*head\s|(?:review|confirmation)\s+(?:at|of)\s)/iu.test(
          line,
        ) || reviewerOf(line),
    )
    .join("\n");
  const patterns = [
    /\b(?:review|confirmation)\s+(?:at|of)\s+`?([0-9a-f]{7,40})\b/giu,
    /^\s*Reviewed (?:commit|head)\s*:\s*`?([0-9a-f]{7,40})\b/gimu,
    /\b(?:reviewed|confirmed)\s+(?:the\s+)?(?:(?:current|published|exact|final)\s+)*head\s+`?([0-9a-f]{7,40})\b/giu,
  ];
  for (const pattern of patterns)
    for (const match of declarations.matchAll(pattern)) {
      const sha = match[1]!.toLowerCase();
      if (sha.length === 40) claims.add(sha);
      else {
        const candidates = [...known].filter((oid) => oid.startsWith(sha));
        if (candidates.length !== 1) return { commit: null, conflict: true };
        claims.add(candidates[0]!);
      }
    }
  return claims.size > 1
    ? { commit: null, conflict: true }
    : { commit: [...claims][0] ?? null, conflict: false };
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
