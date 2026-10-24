import type { WorkItem } from "./worldSources";
import { freshPullRequestDetail } from "./pullRequestFreshness";

/**
 * What World reads about one of your open pull requests beyond its lane, and
 * the owner's merge rules computed from it. Readiness is computed here from
 * what GitHub reported and never stored.
 */

export type PullRequestCheckState = "pass" | "fail" | "pending" | "skipped";

export type PullRequestCheck = {
  name: string;
  state: PullRequestCheckState;
  /** Branch protection requires it for this pull request. */
  required: boolean;
  url?: string;
  completedAt?: number;
};

/**
 * Latest explicitly attributed reviewer results and unattributed RESULT evidence.
 * A crew name is a sender claim from the text, not a verified identity; a shared
 * GitHub login never establishes it. Unknown posts retain separate source links.
 */
export type PullRequestReviewer = {
  /** Explicit sender claim such as `rev4`; null when absent or conflicting. */
  reviewer: string | null;
  /** Stable GitHub review/comment ID, with its URL as the legacy fallback. */
  sourceId?: string;
  url: string;
  at: number;
  /** `confirmed`: every finding resolved and none new; `open`: some remain. */
  outcome: "confirmed" | "open" | "unknown";
  /** The RESULT line as written. */
  line: string;
  /** The head it was given on; null when World cannot tell. */
  commit: string | null;
  /** Commits pushed after `commit`; null when unknown. */
  commitsSince: number | null;
};

export type PullRequestDetail = {
  baseRef: string;
  /** Commits on the base branch that the head does not have; null when unknown. */
  behindBy: number | null;
  checks: PullRequestCheck[];
  /** GitHub listed more checks than World read. */
  checksTruncated: boolean;
  reviewers: PullRequestReviewer[];
  /** It changes the web app or site; null when World could not see every file. */
  uiChange: boolean | null;
  /** Images in the description and in comments from the pull request's own account. */
  images: number;
};

/** The owner's own merge rules, each ✓, ✗ or unknown. */
export type ReadinessRuleId =
  | "draft"
  | "findings"
  | "checks"
  | "mergeable"
  | "screenshots";

export type ReadinessRule = {
  id: ReadinessRuleId;
  label: string;
  state: "pass" | "fail" | "unknown";
  detail: string;
};

export const REVIEWS_COME_FROM_COMMENTS =
  "Reviews come from formal reviews and comments. Reviewer names are explicit sender claims, not verified identities; a shared GitHub login does not identify a crew reviewer.";

export const shortSha = (sha: string) => sha.slice(0, 7);

/** A pull request World can act on: open, yours, and read in detail. */
export function actionablePullRequest(item: WorkItem) {
  return (
    item.kind === "pull_request" &&
    item.lane !== "merged" &&
    item.roles.includes("author") &&
    item.headSha !== undefined
  );
}

export function pullRequestReadiness(item: WorkItem): ReadinessRule[] {
  const detail = freshPullRequestDetail(item) ? item.pr : undefined;
  const failing = detail?.checks.filter((check) => check.state === "fail");
  const running = detail?.checks.filter((check) => check.state === "pending");
  return [
    item.draft
      ? rule("draft", "Not a draft", "fail", "Still a draft")
      : rule("draft", "Not a draft", "pass", "Ready for review"),
    findingsRule(item),
    item.checks === "pass"
      ? rule("checks", "CI green on head", "pass", "All checks passed")
      : item.checks === "fail"
        ? rule(
            "checks",
            "CI green on head",
            "fail",
            failing?.length
              ? `${failing.length} failing: ${failing
                  .slice(0, 3)
                  .map((check) => check.name)
                  .join(", ")}${failing.length > 3 ? ", …" : ""}`
              : "Checks failed",
          )
        : item.checks === "pending"
          ? rule(
              "checks",
              "CI green on head",
              "unknown",
              running?.length ? `${running.length} running` : "Running",
            )
          : rule("checks", "CI green on head", "unknown", "No checks reported"),
    item.mergeable === "mergeable"
      ? rule("mergeable", "Mergeable", "pass", "No conflicts")
      : item.mergeable === "conflicting"
        ? rule(
            "mergeable",
            "Mergeable",
            "fail",
            `Conflicts with ${detail?.baseRef ?? "the base branch"}`,
          )
        : rule("mergeable", "Mergeable", "unknown", "GitHub is still checking"),
    screenshotsRule(detail),
  ];
}

function findingsRule(item: WorkItem): ReadinessRule {
  const label = "Every finding confirmed";
  if (!freshPullRequestDetail(item))
    return rule(
      "findings",
      label,
      "unknown",
      "Details stale or unavailable; refresh Sources",
    );
  const reviewers = item.pr?.reviewers;
  if (!reviewers) return rule("findings", label, "unknown", "Not read yet");
  if (!reviewers.length)
    return rule("findings", label, "unknown", "No reviewer result yet");
  const open = reviewers.filter((entry) => entry.outcome === "open");
  if (open.length)
    return rule(
      "findings",
      label,
      "fail",
      open
        .map(
          (entry) => `${entry.reviewer ?? "Unknown reviewer"}: ${entry.line}`,
        )
        .join("; "),
    );
  const unread = reviewers.filter(
    (entry) => entry.outcome === "unknown" || !entry.reviewer,
  );
  if (unread.length)
    return rule(
      "findings",
      label,
      "unknown",
      unread.some((entry) => !entry.reviewer)
        ? "Reviewer attribution unknown; inspect the linked RESULT evidence"
        : `Can't read ${unread.map((entry) => entry.reviewer).join(", ")}'s result`,
    );
  // A confirmation of an older head says nothing about what came after.
  const stale = reviewers.filter(
    (entry) => entry.commit !== item.headSha || entry.commitsSince !== 0,
  );
  if (stale.length)
    return rule(
      "findings",
      label,
      "unknown",
      stale.map(confirmedAt).join("; "),
    );
  return rule(
    "findings",
    label,
    "pass",
    `${reviewers.map((entry) => entry.reviewer).join(", ")} confirmed`,
  );
}

/** `rev2 confirmed at 1a2b3c4 · 2 commits since`. */
export function confirmedAt(entry: PullRequestReviewer) {
  if (!entry.reviewer) return "Unknown reviewer; attribution required";
  if (!entry.commit) return `${entry.reviewer} confirmed, head unknown`;
  const since =
    entry.commitsSince === null
      ? "head changed since"
      : `${entry.commitsSince} commit${entry.commitsSince === 1 ? "" : "s"} since`;
  return `${entry.reviewer} confirmed at ${shortSha(entry.commit)} · ${since}`;
}

function screenshotsRule(detail: PullRequestDetail | undefined): ReadinessRule {
  const label = "Screenshots for UI changes";
  if (!detail || detail.uiChange === null)
    return rule("screenshots", label, "unknown", "Changed files not read");
  if (!detail.uiChange)
    return rule("screenshots", label, "pass", "Not a UI change");
  return detail.images
    ? rule(
        "screenshots",
        label,
        "pass",
        `${detail.images} image${detail.images === 1 ? "" : "s"}`,
      )
    : rule("screenshots", label, "fail", "UI change without screenshots");
}

function rule(
  id: ReadinessRuleId,
  label: string,
  state: ReadinessRule["state"],
  detail: string,
): ReadinessRule {
  return { id, label, state, detail };
}

export function readyToMerge(item: WorkItem) {
  return (
    actionablePullRequest(item) &&
    pullRequestReadiness(item).every((entry) => entry.state === "pass")
  );
}

/**
 * World never bypasses branch protection. While GitHub still requires a
 * review (which it can't take from your own account), World offers Open on
 * GitHub and the plain merge command to copy, not Merge.
 */
export function mergeUnavailable(item: WorkItem): string | null {
  if (!actionablePullRequest(item))
    return "World can't act on this pull request";
  if (item.review === "review_required")
    return "GitHub requires a review; merge on GitHub.";
  if (item.review === "changes_requested")
    return "Changes were requested on GitHub.";
  return null;
}

/** The command to merge it yourself, shown in full. */
export function mergeCommand(item: WorkItem) {
  return `gh pr merge ${item.number ?? ""} --repo ${item.repo ?? ""} --merge`;
}

export type PullRequestVerb = "merge" | "close" | "ready";

export const PULL_REQUEST_VERB_LABELS: Record<PullRequestVerb, string> = {
  merge: "Merge",
  close: "Close",
  ready: "Mark ready",
};

/** What the confirm sheet says will happen. */
export function verbConsequence(item: WorkItem, verb: PullRequestVerb) {
  const ref = `#${item.number ?? "?"}`;
  const base = item.pr?.baseRef ?? "the base branch";
  if (verb === "close")
    return `Close ${ref} without merging. The branch is kept.`;
  if (verb === "ready") return `Mark ${ref} ready for review.`;
  return `Merge ${ref} into ${base} with a merge commit. Head ${shortSha(item.headSha ?? "")} must still be the head. The branch is kept.`;
}

/** A verb World ran for the viewer: an event with who asked for it. */
export type PullRequestAction = {
  verb: PullRequestVerb;
  itemKey: string;
  ref: string;
  at: number;
  outcome: "done" | "failed";
  /** GitHub's reason, as it gave it, when it failed. */
  detail?: string;
  /** Who asked: the viewer, as this browser session reported it. */
  sender: { basis: "reported"; via: "browser" };
};

/** How long a stalled pull request must stay stalled before it needs you. */
export const STALLED_SETTLE_MS = 2 * 60_000;

/** An agent that works on the pull request, as World sees it now. */
export type PullRequestAuthor = { label: string; idle: boolean };

/** Why a pull request needs you, for Reception and the Town summary. */
export type PullRequestAttention =
  | { reason: "ready"; label: string }
  | { reason: "stalled"; label: string; since: number };

/**
 * - Ready to merge: every readiness rule holds.
 * - Stalled: CI failed on the head, nothing was pushed since (a push makes a
 *   new head), and every agent on it is idle or finished now. `stalledSince`
 *   is when the caller first saw it stalled; it must hold for a moment, so a
 *   turn ending doesn't flicker it in and out. It is not a policy timer.
 */
export function pullRequestAttention(
  item: WorkItem,
  authors: PullRequestAuthor[],
  now: number,
  stalledSince: number | null,
  format: (time: number) => string,
): PullRequestAttention | null {
  if (!actionablePullRequest(item)) return null;
  if (readyToMerge(item)) return { reason: "ready", label: "Ready to merge" };
  const since = stalledAt(item, authors);
  if (
    since === null ||
    stalledSince === null ||
    now - stalledSince < STALLED_SETTLE_MS
  )
    return null;
  return {
    reason: "stalled",
    since,
    label: `CI red since ${format(since)} · ${authors
      .map((author) => author.label)
      .join(", ")} idle`,
  };
}

/** When CI went red on the head, if the pull request is stalled now. */
export function stalledAt(
  item: WorkItem,
  authors: PullRequestAuthor[],
): number | null {
  if (
    !actionablePullRequest(item) ||
    item.checks !== "fail" ||
    !authors.length ||
    !authors.every((author) => author.idle)
  )
    return null;
  const failed = (item.pr?.checks ?? [])
    .filter((check) => check.state === "fail" && check.completedAt)
    .map((check) => check.completedAt!);
  return failed.length ? Math.min(...failed) : null;
}
