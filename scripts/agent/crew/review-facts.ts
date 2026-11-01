import { join } from "node:path";
import type { GateInput } from "../gate/predicate";
import type { Run } from "../gate/observe";
import type { Finding } from "./round-policy-store";

export type CrewPost = {
  id: string;
  body: string;
  at: number;
  url: string;
  commit?: string;
  path?: string;
  line?: number;
  replyTo?: string;
  reviewId?: string;
};

export type ReviewFacts = {
  posts: CrewPost[];
  files: string[];
  commits: string[];
  onlyMain: boolean;
  onlyHarness: boolean;
  carrySafe: boolean;
};

export class ReviewFactsError extends Error {
  constructor(
    message: string,
    readonly permanent = false,
  ) {
    super(message);
  }
}

function pages(run: Run, path: string): Record<string, unknown>[] {
  const result = run([
    "gh",
    "api",
    "--paginate",
    "--jq",
    'if type == "array" then .[] | @json else error("expected array page") end',
    path,
  ]);
  if (result.code !== 0)
    throw new Error("could not read complete review replies");
  return result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("incomplete review reply pages");
      return value as Record<string, unknown>;
    });
}

export function readCrewPosts(run: Run, repo: string, pr: number): CrewPost[] {
  const posts: CrewPost[] = [];
  for (const endpoint of [
    `pulls/${pr}/reviews`,
    `issues/${pr}/comments`,
    `pulls/${pr}/comments`,
  ])
    for (const row of pages(run, `repos/${repo}/${endpoint}?per_page=100`)) {
      if (typeof row.body !== "string") continue;
      const at = Date.parse(String(row.submitted_at ?? row.created_at));
      if (!Number.isFinite(at) || row.id === undefined) continue;
      posts.push({
        id: String(row.id),
        body: row.body,
        at,
        url: String(row.html_url ?? ""),
        ...(typeof row.commit_id === "string" ? { commit: row.commit_id } : {}),
        ...(typeof row.path === "string" ? { path: row.path } : {}),
        ...(typeof row.line === "number" ? { line: row.line } : {}),
        ...(row.in_reply_to_id ? { replyTo: String(row.in_reply_to_id) } : {}),
        ...(row.pull_request_review_id
          ? { reviewId: String(row.pull_request_review_id) }
          : {}),
      });
    }
  return posts.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Main's imported commits never contribute files to an author's delta. */
export function authoredDelta(
  run: Run,
  mirror: string,
  since: string,
  head: string,
) {
  const git = (...args: string[]) => {
    const result = run(["git", "--git-dir", mirror, ...args]);
    if (result.code !== 0)
      throw new Error("could not establish the author delta");
    return result.stdout;
  };
  if (since === head) return { files: [], commits: [], onlyMain: false };
  const ancestor = run([
    "git",
    "--git-dir",
    mirror,
    "merge-base",
    "--is-ancestor",
    since,
    head,
  ]);
  if (ancestor.code !== 0)
    throw new ReviewFactsError(
      "reviewed head is not an ancestor; owner must reconcile rewritten history",
      ancestor.code === 1,
    );
  const path = git(
    "rev-list",
    "--first-parent",
    "--parents",
    "--reverse",
    `${since}..${head}`,
  ).trim();
  const files = new Set<string>();
  const commits: string[] = [];
  let onlyMain = Boolean(path);
  for (const entry of path.split("\n").filter(Boolean)) {
    const [commit, parent, ...others] = entry.split(" ");
    if (!commit || !parent) throw new Error("incomplete commit ancestry");
    let changed: string;
    if (
      others.length === 1 &&
      run([
        "git",
        "--git-dir",
        mirror,
        "merge-base",
        "--is-ancestor",
        others[0]!,
        "refs/heads/main",
      ]).code === 0
    ) {
      // A clean merge contributes nothing. Remerge diffs retain manual
      // conflict resolutions, including edits to a file also changed on main.
      changed = git(
        "show",
        "--format=",
        "--remerge-diff",
        "--no-renames",
        "--name-only",
        "-z",
        commit,
      );
      if (!changed.trim()) continue;
    } else {
      if (others.length)
        throw new ReviewFactsError("merge is not a merge of main", true);
      changed = git(
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        parent,
        commit,
      );
    }
    onlyMain = false;
    commits.push(commit);
    for (const file of changed
      .split("\0")
      .map((file) => file.trim())
      .filter(Boolean))
      files.add(file);
  }
  return { files: [...files].sort(), commits, onlyMain };
}

/** Classify known CI/harness owners by path, never by a commit's message. */
export function harnessFile(file: string) {
  return (
    file.startsWith(".github/workflows/") ||
    file.startsWith("web/src/world/testing/") ||
    /^scripts\/(?:ci-|check-|run-world-tests\.|chrome-warmup\.|world-browser-suites\.|wait-for-quiet\.|test-env\.)/u.test(
      file,
    )
  );
}

/** Synthetic PR data cannot replace workflow, verification or gate policy. */
export function reviewCarryFile(file: string) {
  return file === "web/src/world/testing/pullRequestFixture.ts";
}

export function observeReviewFacts(
  run: Run,
  dir: string,
  repo: string,
  input: GateInput,
  since: string,
): ReviewFacts {
  const delta = authoredDelta(
    run,
    join(dir, "mirror.git"),
    since,
    input.item!.headSha!,
  );
  return {
    ...delta,
    posts: readCrewPosts(run, repo, input.number),
    onlyHarness: delta.files.length > 0 && delta.files.every(harnessFile),
    carrySafe: delta.files.length > 0 && delta.files.every(reviewCarryFile),
  };
}

/** Findings keep stable IDs so two findings on one file need two replies. */
export function openFindings(input: GateInput, posts: CrewPost[]): Finding[] {
  const findings: Finding[] = [];
  for (const claim of input.item?.pr?.reviewers ?? []) {
    if (!claim.reviewer || claim.outcome !== "open") continue;
    const reviewer = claim.reviewer;
    const own = posts.filter(
      (post) =>
        new RegExp(
          `^Reviewer: ${reviewer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
          "mu",
        ).test(post.body) && /^RESULT #\d+:/mu.test(post.body),
    );
    // A confirmation closes that reviewer's prior findings. Otherwise keep
    // older findings: reviewers often report only an unresolved fraction.
    const lastClear = own.findLastIndex(
      (post) =>
        /RESULT #\d+: \d+\/\d+ resolved, 0 new/u.test(post.body) &&
        (() => {
          const m = /RESULT #\d+: (\d+)\/(\d+) resolved/u.exec(post.body)!;
          return m[1] === m[2];
        })(),
    );
    const active = own.slice(lastClear + 1);
    const respondAfter = Math.max(claim.at, own.at(-1)?.at ?? claim.at);
    const seen = new Set<string>();
    for (const post of active) {
      let index = 0;
      const inline = posts.filter(
        (comment) =>
          comment.reviewId === post.id &&
          !comment.replyTo &&
          comment.path &&
          /\bP[123]\b/u.test(comment.body),
      );
      for (const comment of inline)
        findings.push({
          id: `${reviewer}:${comment.id}:1`,
          reviewer,
          file: comment.path!,
          line: comment.line ?? null,
          text: comment.body,
          at: comment.at,
          url: comment.url,
          source: comment.id,
          respondAfter,
        });
      for (const line of post.body.split("\n")) {
        if (!/\bP[123]\b/u.test(line)) continue;
        const location =
          /(?:`|\s|\(|^)((?:[\w.@-]+\/)*[\w.@-]+):(\d+)/u.exec(line) ??
          /(?:`|\s|\(|^)((?:[\w.@-]+\/)*[\w.@-]+\.[\w.-]+)/u.exec(line);
        const file = location?.[1] ?? null;
        const lineNumber = location?.[2] ? Number(location[2]) : null;
        if (
          inline.some(
            (comment) => comment.path === file && comment.line === lineNumber,
          )
        )
          continue;
        const signature = `${file}:${lineNumber}:${line.trim()}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        findings.push({
          id: `${reviewer}:${post.id}:${++index}`,
          reviewer,
          file,
          line: lineNumber,
          text: line.trim(),
          at: post.at,
          url: post.url,
          respondAfter,
        });
      }
    }
    // An unparseable open RESULT must never silently count as answered.
    if (!findings.some((finding) => finding.reviewer === reviewer))
      findings.push({
        id: `${reviewer}:${claim.sourceId ?? "unknown"}:open`,
        reviewer,
        file: null,
        line: null,
        text: claim.line,
        at: claim.at,
        url: claim.url,
        respondAfter,
      });
  }
  return findings;
}

export function withReplies(
  findings: Finding[],
  posts: CrewPost[],
  author: string | null,
  pr: number,
  after = 0,
) {
  const mentions = (line: string, token: string) =>
    new RegExp(
      `(?<![\\w/.:\\-])${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\w/.:\\-])`,
      "u",
    ).test(line);
  return findings.map((finding) => {
    const sameFile = findings.filter(
      (other) => other.file === finding.file,
    ).length;
    const sameLocation = findings.filter(
      (other) => other.file === finding.file && other.line === finding.line,
    ).length;
    const reply = posts.find(
      (post) =>
        post.at > Math.max(finding.at, finding.respondAfter ?? 0, after) &&
        (post.body.startsWith(`[${author}]`) ||
          post.body.startsWith(`[fixer #${pr}]`)) &&
        ((finding.source && post.replyTo === finding.source) ||
          post.body
            .split("\n")
            .some(
              (line) =>
                mentions(line, finding.id) ||
                (finding.file &&
                  (sameFile === 1
                    ? mentions(line, finding.file) ||
                      (finding.line !== null &&
                        mentions(line, `${finding.file}:${finding.line}`))
                    : finding.line !== null &&
                      sameLocation === 1 &&
                      mentions(line, `${finding.file}:${finding.line}`))),
            )),
    );
    return { ...finding, reply: reply ? reply.url || reply.id : undefined };
  });
}
