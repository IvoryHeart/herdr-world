import type { PullRequestAction, PullRequestDetail } from "./pullRequests";

/**
 * Built-in sources: systems of record that World reads alongside Herdr, such
 * as GitHub pull requests and Jira tickets. The service owns each source's
 * credentials and requests; the browser sees only these display-safe records.
 */

export const WORLD_SOURCE_IDS = ["github", "jira"] as const;
export type WorldSourceId = (typeof WORLD_SOURCE_IDS)[number];

/**
 * - `connected`: the last refresh succeeded.
 * - `not_connected`: a prerequisite is missing; `detail` says what to do.
 * - `error`: it is set up, but the last refresh failed.
 * - `disabled`: switched off in settings.
 */
export type WorldSourceState =
  | "connected"
  | "not_connected"
  | "error"
  | "disabled";

export type WorldSourceStatus = {
  id: WorldSourceId;
  label: string;
  enabled: boolean;
  state: WorldSourceState;
  /** Plain guidance for the current state; never a raw CLI or HTTP error. */
  detail: string;
  checkedAt: number;
  lastSuccessAt: number | null;
  itemCount: number;
  /** Display-safe settings. Secrets are reported only as set or not set. */
  config: WorldSourcePublicConfig;
};

export type WorldSourcePublicConfig =
  | { kind: "github"; mergedDays: number }
  | {
      kind: "jira";
      site: string | null;
      email: string | null;
      jql: string;
      tokenSet: boolean;
    };

/** Pull request lanes, in Board order. */
export const PULL_REQUEST_LANES = [
  "review",
  "fixing",
  "green",
  "ready",
  "merged",
] as const;
export type PullRequestLane = (typeof PULL_REQUEST_LANES)[number];

/** Ticket and issue lanes, by Jira status category, in Board order. */
export const TICKET_LANES = ["todo", "doing", "done"] as const;
export type TicketLane = (typeof TICKET_LANES)[number];

export const WORK_LANE_LABELS: Record<PullRequestLane | TicketLane, string> = {
  review: "In review",
  fixing: "Fixing",
  green: "Green",
  ready: "Ready to merge",
  merged: "Merged",
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

export type WorkChecks = "pass" | "fail" | "pending" | "none";
export type WorkReview =
  | "approved"
  | "changes_requested"
  | "review_required"
  | "none";
export type WorkRole = "author" | "reviewer" | "assignee" | "watcher";

/** Detail health is independent of a successful GitHub list refresh. */
export type PullRequestDetailObservation = {
  source: "github";
  state: "fresh" | "stale" | "unavailable";
  headSha: string;
  readAt: number | null;
  expiresAt: number | null;
};

export type WorkItem = {
  /** Stable across refreshes: `github:pr:owner/repo#12`, `jira:ABC-1`. */
  key: string;
  source: WorldSourceId;
  kind: "pull_request" | "issue" | "ticket";
  /** Short reference shown on cards: `owner/repo#12` or `ABC-1`. */
  ref: string;
  title: string;
  url: string;
  lane: PullRequestLane | TicketLane;
  /** The source's own status name, such as a Jira workflow status. */
  status: string;
  roles: WorkRole[];
  updatedAt: number;
  /** When it finished: a pull request merged, a Done ticket resolved. */
  finishedAt?: number;
  /** Pull requests only. */
  number?: number;
  repo?: string;
  branch?: string;
  /** The repository the branch lives in (a fork's, for a fork's PR); absent when GitHub no longer knows it. */
  headRepo?: string;
  draft?: boolean;
  checks?: WorkChecks;
  review?: WorkReview;
  mergeable?: "mergeable" | "conflicting" | "unknown";
  /** The branch it merges into (open pull requests). */
  base?: string;
  /** The head commit GitHub reported (open pull requests). */
  headSha?: string;
  /** Your open pull requests: checks, reviewer results and files, read in detail. */
  pr?: PullRequestDetail;
  prObservation?: PullRequestDetailObservation;
};

/** A work item linked to the agent pane whose checkout or report names it. */
export type WorkLink = {
  connectionId: string;
  /** The runtime generation the pane was observed in. */
  generation: number;
  paneId: string;
  /** The pane's agent session when linked; null for none. */
  sessionFingerprint: string | null;
  itemKey: string;
  /** `branch`: the pane's checkout branch; `reported`: the agent reported it. */
  via: "branch" | "reported";
};

export type WorldSourcesSnapshot = {
  observedAt: number;
  /** A refresh is still running; ask again shortly for its result. */
  refreshing: boolean;
  sources: WorldSourceStatus[];
  items: WorkItem[];
  links: WorkLink[];
  /** Pull request verbs run from World since the service started, newest first. */
  actions: PullRequestAction[];
};

const CHECK_GLYPH: Record<WorkChecks, string> = {
  pass: "✓",
  fail: "✗",
  pending: "●",
  none: "",
};

/** A compact badge: `#123 ✓` for a pull request, the key for a ticket. */
export function workBadgeText(item: WorkItem): string {
  if (item.kind === "pull_request") {
    const glyph =
      item.lane === "merged" ? "◆" : CHECK_GLYPH[item.checks ?? "none"];
    return `#${item.number ?? "?"}${glyph ? ` ${glyph}` : ""}`;
  }
  return item.kind === "issue" ? `#${item.number ?? "?"}` : item.ref;
}

/**
 * Where a pull request stands, worst first: anything that needs the author
 * is fixing; drafts and pending checks are still in review. Approved is
 * ready, and so is a passing PR in a repository that requires no review
 * (GitHub reports no decision there). Passing but awaiting a required
 * review is green.
 */
export function pullRequestLane(pr: {
  merged: boolean;
  draft: boolean;
  checks: WorkChecks;
  review: WorkReview;
  mergeable: "mergeable" | "conflicting" | "unknown";
}): PullRequestLane {
  if (pr.merged) return "merged";
  if (
    pr.review === "changes_requested" ||
    pr.checks === "fail" ||
    pr.mergeable === "conflicting"
  )
    return "fixing";
  if (pr.draft || pr.checks === "pending") return "review";
  if (pr.review === "approved") return "ready";
  if (pr.review === "none" && pr.checks === "pass") return "ready";
  return pr.checks === "pass" ? "green" : "review";
}
