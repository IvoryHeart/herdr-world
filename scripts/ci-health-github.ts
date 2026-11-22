import { execFileSync } from "node:child_process";

export type Run = {
  id: number;
  name: string;
  event: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  conclusion: string | null;
  run_attempt: number;
  html_url: string;
};
export type Job = {
  name: string;
  conclusion: string | null;
  labels: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  steps: {
    name: string;
    conclusion: string | null;
    started_at?: string;
    completed_at?: string;
  }[];
};
export type Pull = {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  mergedAt: string;
  mergeCommit: { oid: string } | null;
  commits: { nodes: { commit: { committedDate: string } }[] };
  labels: { nodes: { name: string }[] };
};
export type Release = {
  tagName: string;
  publishedAt: string;
  isPrerelease: boolean;
  tagCommit: { oid: string } | null;
};
export type HealthData = {
  runs: Run[];
  jobs: { run: Run; jobs: Job[] }[];
  attempts: Run[];
  pulls: Pull[];
  releases: Release[];
  shipped: Map<string, Set<string>>;
  requests: number;
  limits: string[];
};
export type Github = (args: string[]) => unknown;
export const REQUEST_LIMIT = 100;

/** No credential is read into this process and no gh response is written to disk. */
export const github: Github = (args) =>
  JSON.parse(
    execFileSync("gh", ["api", ...args], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

/** Spread a bounded job sample across the whole window, including both ends. */
export function spread<T>(values: readonly T[], limit: number): T[] {
  if (limit === 1) return values.length ? [values[0]!] : [];
  if (values.length <= limit) return [...values];
  return Array.from(
    { length: limit },
    (_, index) =>
      values[Math.round((index * (values.length - 1)) / (limit - 1))]!,
  );
}

export function collectHealth(
  repo: string,
  since: Date,
  api: Github = github,
): HealthData {
  if (!/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(repo))
    throw new Error("Invalid repository");
  const data: HealthData = {
    runs: [],
    jobs: [],
    attempts: [],
    pulls: [],
    releases: [],
    shipped: new Map(),
    requests: 0,
    limits: [],
  };
  const request = (args: string[]): any => {
    if (++data.requests > REQUEST_LIMIT)
      throw new Error("GitHub request budget exhausted");
    return api(args);
  };
  const get = (path: string) => request([`repos/${repo}/${path}`]);
  const optional = (path: string) => {
    try {
      return get(path);
    } catch {
      data.limits.push(`unavailable read: ${path.split("?")[0]}`);
      return undefined;
    }
  };
  for (let page = 1; page <= 10; page++) {
    const response = get(
      `actions/runs?per_page=100&page=${page}&created=>=${since.toISOString()}`,
    );
    const runs = response.workflow_runs as Run[];
    data.runs.push(
      ...runs.filter((run) => Date.parse(run.created_at) >= +since),
    );
    if (
      runs.length < 100 ||
      (runs.at(-1) && Date.parse(runs.at(-1)!.created_at) < +since)
    )
      break;
    if (page === 10) data.limits.push("run inventory capped at 1,000");
  }
  const ci = data.runs.filter(
    (run) =>
      run.name === "CI" && run.event === "pull_request" && run.conclusion,
  );
  const others = data.runs.filter(
    (run) =>
      ["Deploy Pages", "World latency trend"].includes(run.name) &&
      run.conclusion === "success",
  );
  for (const run of [...spread(ci, 50), ...spread(others, 6)]) {
    const response = optional(
      `actions/runs/${run.id}/jobs?per_page=100&filter=latest`,
    );
    if (!response) continue;
    data.jobs.push({ run, jobs: response.jobs });
    if (response.total_count > 100)
      data.limits.push(`run ${run.id} jobs capped at 100`);
  }
  if (ci.length > 50)
    data.limits.push(
      `jobs sampled ${Math.min(ci.length, 50)}/${ci.length} PR runs, evenly by time`,
    );
  // A rerun uses the same event/merge SHA. Ordinary pushes on the same branch
  // are not unchanged-commit experiments. Keep failed attempts in the denominator.
  const reruns = ci.filter((run) => run.run_attempt > 1);
  for (const run of spread(reruns, 4)) {
    data.attempts.push(run);
    for (
      let attempt = Math.max(1, run.run_attempt - 2);
      attempt < run.run_attempt;
      attempt++
    ) {
      const previous = optional(`actions/runs/${run.id}/attempts/${attempt}`);
      if (previous) data.attempts.push(previous);
    }
  }
  const [owner, name] = repo.split("/");
  const response = request([
    "graphql",
    "-f",
    `query=query($owner:String!,$name:String!,$search:String!){ repository(owner:$owner,name:$name){ releases(first:20,orderBy:{field:CREATED_AT,direction:DESC}){nodes{tagName publishedAt isPrerelease tagCommit{oid}} pageInfo{hasNextPage}} } search(query:$search,type:ISSUE,first:100){issueCount nodes{... on PullRequest{number title body createdAt mergedAt mergeCommit{oid} commits(first:1){nodes{commit{committedDate}}} labels(first:20){nodes{name}}}}}}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `search=repo:${repo} is:pr is:merged base:main merged:>=${since.toISOString().slice(0, 10)}`,
  ]);
  if (response.errors?.length)
    throw new Error("GitHub delivery query returned errors");
  data.pulls = response.data.search.nodes.filter(
    (pull: Pull) => pull?.mergedAt && Date.parse(pull.mergedAt) >= +since,
  );
  data.releases = response.data.repository.releases.nodes
    .filter(
      (release: Release) =>
        release.publishedAt && !release.isPrerelease && release.tagCommit,
    )
    .sort(
      (a: Release, b: Release) =>
        Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
    );
  if (response.data.search.issueCount > 100)
    data.limits.push("merged PR inventory capped at 100");
  if (response.data.repository.releases.pageInfo.hasNextPage)
    data.limits.push("release history capped at 20, including prereleases");
  // Compare immutable release commits with the oldest in-window merge. The
  // commit list then maps every squash/merge SHA to its first published release.
  // Missing/over-250 comparisons remain unknown, never 'unreleased'.
  const oldest = [...data.pulls]
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))
    .find((pull) => pull.mergeCommit);
  if (oldest?.mergeCommit) {
    for (const release of data.releases
      .filter(
        (release) =>
          Date.parse(release.publishedAt) >= Date.parse(oldest.mergedAt),
      )
      .slice(0, 20)) {
      const comparison = optional(
        `compare/${oldest.mergeCommit.oid}...${release.tagCommit!.oid}`,
      );
      if (!comparison) continue;
      if (
        !["ahead", "identical"].includes(comparison.status) ||
        comparison.total_commits > 250
      ) {
        data.limits.push(`release ${release.tagName} ancestry incomplete`);
        continue;
      }
      data.shipped.set(
        release.tagName,
        new Set([
          oldest.mergeCommit.oid,
          ...comparison.commits.map((commit: { sha: string }) => commit.sha),
        ]),
      );
    }
  }
  return data;
}
