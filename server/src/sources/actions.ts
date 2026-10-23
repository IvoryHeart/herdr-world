import {
  actionablePullRequest,
  type PullRequestVerb,
} from "../../../shared/pullRequests";
import type { WorkItem } from "../../../shared/worldSources";
import { record, type RunProcess } from "./github";

/**
 * Pull request verbs the viewer confirmed in World: merge (a merge commit,
 * pinned to the head they saw), close and mark ready, run with the service
 * user's `gh` sign-in. World never bypasses branch protection: while GitHub
 * still requires a review it refuses to merge, and anything GitHub refuses
 * comes back in GitHub's words.
 *
 * Owner-only is a crew rule, not something World enforces: agents run as the
 * same user with the same `gh` sign-in. World exposes these verbs to the
 * browser only, not to its CLI, agent skill or MCP.
 */

const TIMEOUT_MS = 30_000;
const MAX_DETAIL = 500;
export const MAX_CLOSE_COMMENT = 4_000;

export type PullRequestVerbRequest = {
  verb: PullRequestVerb;
  /** The head the viewer saw; merge refuses if it moved. */
  headSha?: string;
  /** Close only: posted as a comment on the pull request. */
  comment?: string;
};

export type VerbOutcome = { ok: true } | { ok: false; detail: string };

export const HEAD_CHANGED = "Head changed: review again.";
export const REVIEW_REQUIRED = "GitHub requires a review; merge on GitHub.";

export async function runPullRequestVerb(
  run: RunProcess,
  item: WorkItem,
  request: PullRequestVerbRequest,
): Promise<VerbOutcome> {
  if (!actionablePullRequest(item) || !item.repo || item.number === undefined)
    return { ok: false, detail: "World can't act on this pull request." };
  const target = [String(item.number), "--repo", item.repo];
  if (request.verb === "ready") {
    if (!item.draft)
      return { ok: false, detail: "It is already ready for review." };
    return gh(run, ["gh", "pr", "ready", ...target]);
  }
  if (request.verb === "close")
    return gh(run, [
      "gh",
      "pr",
      "close",
      ...target,
      ...(request.comment ? ["--comment", request.comment] : []),
    ]);
  const seen = request.headSha;
  if (!seen || !/^[0-9a-f]{40}$/u.test(seen))
    return { ok: false, detail: "Merge needs the head you reviewed." };
  // Read it again just before merging: World's list may be a minute old.
  const now = await currentState(run, item);
  if (!now.ok) return now;
  if (now.state !== "OPEN")
    return { ok: false, detail: `It is ${now.state.toLowerCase()} already.` };
  if (now.head !== seen) return { ok: false, detail: HEAD_CHANGED };
  if (now.review === "REVIEW_REQUIRED" || now.review === "CHANGES_REQUESTED")
    return { ok: false, detail: REVIEW_REQUIRED };
  const merged = await gh(run, [
    "gh",
    "pr",
    "merge",
    ...target,
    "--merge",
    "--match-head-commit",
    seen,
  ]);
  return !merged.ok && /head branch was modified/iu.test(merged.detail)
    ? { ok: false, detail: HEAD_CHANGED }
    : merged;
}

async function currentState(
  run: RunProcess,
  item: WorkItem,
): Promise<
  | { ok: true; state: string; head: string; review: string | null }
  | { ok: false; detail: string }
> {
  const [owner, name] = item.repo!.split("/");
  const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${item.number}) { state headRefOid reviewDecision } } }`;
  let result;
  try {
    result = await run(
      ["gh", "api", "graphql", "-f", `query=${query}`],
      TIMEOUT_MS,
    );
  } catch {
    return { ok: false, detail: "GitHub did not answer." };
  }
  if (result.code !== 0) return { ok: false, detail: reason(result) };
  try {
    const pr = record(
      record(record(record(JSON.parse(result.stdout)).data).repository)
        .pullRequest,
    );
    if (typeof pr.state !== "string" || typeof pr.headRefOid !== "string")
      throw new Error("no pull request");
    return {
      ok: true,
      state: pr.state,
      head: pr.headRefOid,
      review: typeof pr.reviewDecision === "string" ? pr.reviewDecision : null,
    };
  } catch {
    return { ok: false, detail: "GitHub did not return the pull request." };
  }
}

async function gh(run: RunProcess, argv: string[]): Promise<VerbOutcome> {
  try {
    const result = await run(argv, TIMEOUT_MS);
    return result.code === 0
      ? { ok: true }
      : { ok: false, detail: reason(result) };
  } catch {
    return { ok: false, detail: "GitHub did not answer." };
  }
}

/** GitHub's own words, without terminal colour or control characters. */
export function reason(result: { stderr: string; stdout: string }) {
  const text = (result.stderr.trim() || result.stdout.trim())
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, "")
    .replace(/^[XxＸ✗!]\s+/u, "")
    .trim();
  return [...(text || "GitHub refused without a reason.")]
    .slice(0, MAX_DETAIL)
    .join("");
}
