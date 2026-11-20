/** Read-only contract shared by the CLI and future Town/Board consumers. */
export const SHIPYARD_LIMITS = {
  repositories: 8,
  releases: 50,
  tags: 100,
  workflows: 100,
  commits: 200,
  prsPerCommit: 5,
  instances: 64,
  refreshMs: 60_000,
  forcedRefreshMs: 5_000,
  deadlineMs: 60_000,
  requestMs: 10_000,
  outputBytes: 4 * 1024 * 1024,
  waitMs: 2_000,
  instanceLeaseMs: 45_000,
} as const;

export function shipyardRepository(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/u.test(
      value,
    ) ||
    value.endsWith("/.") ||
    value.endsWith("/..")
  )
    throw new Error("Repository must be a github.com owner/repository name");
  return value.toLowerCase();
}

export type ShipyardWindow<T> = {
  items: T[];
  /** False means truncated or unavailable; never infer absence from it. */
  complete: boolean;
  detail: string | null;
};
export type ShipyardRelease = {
  id: number;
  tag: string;
  version: string;
  name: string;
  publishedAt: number;
  channel: "stable" | "prerelease";
  url: string;
};
export type ShipyardTag = { name: string; sha: string; url: string };
export type ShipyardWorkflow = {
  id: number;
  workflowId: number;
  name: string;
  sha: string;
  status: string;
  conclusion: string | null;
  updatedAt: number;
  url: string;
};
export type ShipyardPullRequest = {
  number: number;
  title: string;
  mergedAt: number;
  mergeSha: string;
  url: string;
};
export type ShipyardBaseline = {
  releaseId: number;
  tag: string;
  sha: string;
  channel: ShipyardRelease["channel"];
};
export type ShipyardPipeline = {
  repo: string;
  main: {
    branch: "main";
    sha: string;
    /** Observed latest workflow per workflow ID on this SHA, not a release gate. */
    health: "pass" | "fail" | "pending" | "unknown";
    workflows: ShipyardWindow<ShipyardWorkflow>;
    url: string;
  };
  releases: ShipyardWindow<ShipyardRelease>;
  tags: ShipyardWindow<ShipyardTag>;
  waiting: {
    state: "ready" | "no_baseline" | "limited" | "diverged" | "unavailable";
    baseline: ShipyardBaseline | null;
    mainSha: string;
    aheadBy: number | null;
    commits: string[];
    pullRequests: ShipyardPullRequest[];
    complete: boolean;
    detail: string | null;
    compareUrl: string | null;
    /** Search is a navigation aid; membership above is proved by commit graph. */
    pullRequestsUrl: string;
  };
};
export type ShipyardInstance = {
  id: string;
  generation: string;
  version: string;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  kind: "source" | "installed";
  port: number;
  startedAt: number;
  reportedAt: number;
  expiresAt: number;
  state: "fresh" | "stale";
  /** Fresh loopback listeners only; never embeds a token or remote host. */
  openUrl: string | null;
  /** Exact repository + normalized release tag/version match, not a heuristic. */
  releaseId: number | null;
};
export type ShipyardSnapshot = {
  observedAt: number;
  repo: string;
  source: "github";
  state: "fresh" | "stale" | "unavailable" | "not_connected" | "disabled";
  detail: string;
  checkedAt: number | null;
  lastSuccessAt: number | null;
  refreshing: boolean;
  retryAfterMs: number;
  data: ShipyardPipeline | null;
  instances: ShipyardWindow<ShipyardInstance>;
  limits: typeof SHIPYARD_LIMITS;
};
export type ShipyardCatalog = {
  observedAt: number;
  /** Suggestions from existing source work, observed instances and cached reads. */
  repositories: string[];
  instances: ShipyardWindow<ShipyardInstance>;
  limits: typeof SHIPYARD_LIMITS;
};
