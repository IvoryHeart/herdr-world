import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../shared/pullRequestFreshness";
import type {
  PullRequestCheck,
  PullRequestReviewer,
} from "../../../shared/pullRequests";
import type { WorkChecks } from "../../../shared/worldSources";
import {
  PR_FIELDS,
  parseGitHubResponse,
  record,
} from "../../../server/src/sources/github";
import {
  DETAIL_BATCH,
  detailQuery,
  parseDetails,
  postsOf,
  reviewerResults,
  trustedPosts,
} from "../../../server/src/sources/pullRequestDetail";
import {
  copyRule,
  ensureMirror,
  fetchCommit,
  fetchPulls,
  overlap,
} from "./git";
import { reviewedPosts } from "./review-posts";
import {
  fullOutcomes,
  jobId,
  latestChecks,
  type CheckAttempt,
  type Execution,
  type CopyResult,
  type GateConfig,
  type GateInput,
} from "./predicate";

/**
 * One read of GitHub and git into predicate inputs. The list and detail
 * queries are World's own, so the gate and the PR card read the same facts.
 * A failed request fails the whole read: no partial pass is ever recorded.
 */

export type Run = (argv: string[]) => {
  code: number;
  stdout: string;
  stderr: string;
};

export const runProcess: Run = (argv) => {
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const MAX_OPEN = 100;

export function listQuery(repo: string, numbers: number[]) {
  const [owner, name] = repo.split("/");
  const fields = `${PR_FIELDS} labels(first: 20) { nodes { name } }`;
  if (numbers.length)
    return `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
${numbers.map((number, index) => `  p${index}: pullRequest(number: ${number}) { ${fields} }`).join("\n")}
} }`;
  return `query { open: search(query: ${JSON.stringify(`repo:${repo} is:pr is:open archived:false`)}, type: ISSUE, first: ${MAX_OPEN}) {
  issueCount nodes { ... on PullRequest { ${fields} } }
} }`;
}

export function graphql(run: Run, text: string) {
  const result = run(["gh", "api", "graphql", "-f", `query=${text}`]);
  if (result.code !== 0)
    throw new Error(
      `GitHub request failed: ${result.stderr.trim().slice(0, 300)}`,
    );
  const response = record(JSON.parse(result.stdout));
  if (Array.isArray(response.errors) && response.errors.length)
    throw new Error("GitHub returned a partial response");
  return record(response.data);
}

function restJson(run: Run, path: string) {
  const result = run(["gh", "api", path]);
  if (result.code !== 0)
    throw new Error(
      `GitHub request failed: ${result.stderr.trim().slice(0, 300)}`,
    );
  return record(JSON.parse(result.stdout));
}

/** Raw pull request nodes: the open ones, or exactly those asked for. */
export function listPullRequests(run: Run, repo: string, numbers: number[]) {
  const data = graphql(run, listQuery(repo, numbers));
  if (!numbers.length) {
    const open = record(data.open);
    if (Number(open.issueCount) > MAX_OPEN)
      throw new Error(`More than ${MAX_OPEN} open pull requests; pass --pr`);
    return list(open.nodes).filter((node) => Number.isSafeInteger(node.number));
  }
  const repository = record(data.repository);
  return numbers.map((number, index) => {
    const node = record(repository[`p${index}`]);
    if (node.number !== number)
      throw new Error(`Pull request #${number} not found`);
    return node;
  });
}

type WorkflowRun = {
  id: number;
  workflowId: number;
  runNumber: number;
  latestAttempt: number;
};

/** The Actions workflow runs on `head`. */
export function workflowRuns(run: Run, repo: string, head: string) {
  return list(
    restJson(run, `repos/${repo}/actions/runs?head_sha=${head}&per_page=100`)
      .workflow_runs,
  )
    .map(
      (entry): WorkflowRun => ({
        id: Number(entry.id),
        workflowId: Number(entry.workflow_id),
        runNumber: Number(entry.run_number),
        latestAttempt: Number(entry.run_attempt),
      }),
    )
    .filter((entry) => Number.isSafeInteger(entry.id));
}

/** Earlier attempts of each workflow run; the latest is in the rollup. */
export function earlierAttempts(
  run: Run,
  repo: string,
  runs: WorkflowRun[],
): CheckAttempt[] {
  const attempts: CheckAttempt[] = [];
  for (const entry of runs) {
    if (!(entry.latestAttempt > 1)) continue;
    for (let attempt = 1; attempt < entry.latestAttempt; attempt++) {
      const jobs = list(
        restJson(
          run,
          `repos/${repo}/actions/runs/${entry.id}/attempts/${attempt}/jobs?per_page=100`,
        ).jobs,
      );
      for (const job of jobs)
        if (typeof job.name === "string")
          attempts.push({
            runId: entry.id,
            attempt,
            name: job.name,
            conclusion:
              typeof job.conclusion === "string" ? job.conclusion : "unknown",
            completedAt: Date.parse(String(job.completed_at)) || 0,
            ...(Number.isSafeInteger(job.id)
              ? { jobId: job.id as number }
              : {}),
          });
    }
  }
  return attempts;
}

/**
 * The workflow execution behind each job of a check that ran more than once,
 * by job ID. A job GitHub won't describe, or whose run isn't among the
 * head's runs, stays unknown.
 */
export function executionsOf(
  run: Run,
  repo: string,
  checks: PullRequestCheck[],
  runs: WorkflowRun[],
) {
  const byRun = new Map(runs.map((entry) => [entry.id, entry]));
  const names = new Map<string, number>();
  for (const check of checks)
    names.set(check.name, (names.get(check.name) ?? 0) + 1);
  const executions: Record<string, Execution> = {};
  for (const check of checks) {
    const id = jobId(check);
    if (id === null || names.get(check.name)! < 2) continue;
    // A job GitHub won't describe stays unknown, which fails closed.
    const result = run(["gh", "api", `repos/${repo}/actions/jobs/${id}`]);
    if (result.code !== 0) continue;
    const job = record(JSON.parse(result.stdout));
    const owner = byRun.get(Number(job.run_id));
    const attempt = Number(job.run_attempt);
    if (owner && Number.isSafeInteger(attempt))
      executions[String(id)] = {
        runId: owner.id,
        workflowId: owner.workflowId,
        runNumber: owner.runNumber,
        attempt,
      };
  }
  return executions;
}

export function observe(options: {
  run: Run;
  config: GateConfig;
  numbers: number[];
  mirror: string;
  now: number;
}): GateInput[] {
  const { run, config, numbers, mirror, now } = options;
  const nodes = listPullRequests(run, config.repo, numbers);
  const labels = new Map(
    nodes.map((node) => [
      Number(node.number),
      list(record(node.labels).nodes)
        .map((label) => label.name)
        .filter((name): name is string => typeof name === "string"),
    ]),
  );
  const open = nodes.filter((node) => node.state === "OPEN");
  const items = parseGitHubResponse({ data: { authored: { nodes: open } } });
  const commitsOf = new Map<number, { oid: string; at: number }[]>();
  for (let start = 0; start < items.length; start += DETAIL_BATCH) {
    const chunk = items.slice(start, start + DETAIL_BATCH);
    const data = graphql(run, detailQuery(chunk));
    const details = parseDetails(chunk, data);
    chunk.forEach((item, index) => {
      const detail = details.get(item.key);
      if (!detail || !item.headSha) return;
      item.pr = detail;
      item.prObservation = {
        source: "github",
        state: "fresh",
        headSha: item.headSha,
        readAt: now,
        expiresAt: now + PULL_REQUEST_DETAIL_MAX_AGE_MS,
      };
      const pr = record(record(data[`p${index}`]).pullRequest);
      commitsOf.set(
        item.number!,
        list(record(pr.commits).nodes).map((node) => {
          const commit = record(node.commit);
          return {
            oid: typeof commit.oid === "string" ? commit.oid : "",
            at: Date.parse(String(commit.committedDate)) || 0,
          };
        }),
      );
    });
  }
  const remote = config.remote ?? `https://github.com/${config.repo}.git`;
  if (items.length) {
    ensureMirror(mirror);
    fetchPulls(
      mirror,
      remote,
      items.map((item) => item.number!),
    );
  }
  const inventories = new Map<string, string[] | null>();
  const byNumber = new Map(items.map((item) => [item.number!, item]));
  return nodes.map((node): GateInput => {
    const number = Number(node.number);
    const state =
      node.state === "MERGED"
        ? "MERGED"
        : node.state === "OPEN"
          ? "OPEN"
          : "CLOSED";
    const item = byNumber.get(number);
    const base: GateInput = {
      number,
      state,
      labels: labels.get(number) ?? [],
      history: [],
      historyComplete: false,
      requiredChecks: null,
      attempts: [],
      copies: {},
      hold: null,
      waived: [],
      outcomes: {},
      executions: {},
      overlap: null,
      readAt: now,
    };
    if (!item?.headSha || !item.pr)
      return state === "OPEN" && item ? { ...base, item } : base;
    const head = item.headSha;
    const branch = item.base ?? "main";
    const runs = workflowRuns(run, config.repo, head);
    const executions = executionsOf(run, config.repo, item.pr.checks, runs);
    // The list's summary is older than the detail; the worse one stands.
    item.checks = worse(
      item.checks ?? "none",
      summary(item.pr.checks, executions),
    );
    if (!inventories.has(branch))
      inventories.set(branch, requiredInventory(run, config, branch));
    const required = inventories.get(branch)!;
    const flagged = item.pr.checks
      .filter((check) => check.required)
      .map((check) => check.name);
    const evidence = reviewHistory(run, config.repo, number);
    const commits = commitsOf.get(number) ?? [];
    const rawPosts = trustedPosts(evidence.posts);
    const posts = reviewedPosts(number, rawPosts, commits, head, mirror);
    // Full history, not the PR card's bounded window, decides findings.
    item.pr = {
      ...item.pr,
      reviewers: reviewerResults(number, posts, commits, head),
    };
    const history = posts
      .toSorted((a, b) => a.at - b.at)
      .flatMap((post) => reviewerResults(number, [post], commits, head));
    return {
      ...base,
      item,
      history,
      reviewPosts: rawPosts,
      historyComplete: evidence.complete,
      outcomes: fullOutcomes(number, posts),
      requiredChecks: required && [...new Set([...required, ...flagged])],
      attempts: earlierAttempts(run, config.repo, runs),
      executions,
      copies: copies(mirror, remote, head, history),
      overlap: overlap(mirror, head),
    };
  });
}

const RANK: Record<WorkChecks, number> = {
  pass: 0,
  none: 1,
  pending: 2,
  fail: 3,
};

function worse(a: WorkChecks, b: WorkChecks) {
  return RANK[a] >= RANK[b] ? a : b;
}

function summary(
  all: PullRequestCheck[],
  executions: Record<string, Execution>,
): WorkChecks {
  const checks = latestChecks(all, executions).latest;
  if (!checks.length) return "none";
  if (checks.some((check) => check.state === "fail")) return "fail";
  if (checks.some((check) => check.state === "pending")) return "pending";
  return "pass";
}

/**
 * The base branch's required checks from GitHub's rules, plus classic branch
 * protection when readable and the configured names. Unknown (null) when the
 * rules can't be read or name nothing and the config doesn't settle it.
 */
export function requiredInventory(
  run: Run,
  config: GateConfig,
  branch: string,
): string[] | null {
  const names = new Set(config.requiredChecks ?? []);
  const rules = run([
    "gh",
    "api",
    `repos/${config.repo}/rules/branches/${branch}`,
  ]);
  let found = false;
  if (rules.code === 0)
    for (const rule of list(JSON.parse(rules.stdout))) {
      if (rule.type !== "required_status_checks") continue;
      for (const entry of list(record(rule.parameters).required_status_checks))
        if (typeof entry.context === "string") {
          names.add(entry.context);
          found = true;
        }
    }
  const protection = run([
    "gh",
    "api",
    `repos/${config.repo}/branches/${branch}/protection/required_status_checks`,
  ]);
  if (protection.code === 0) {
    const value = record(JSON.parse(protection.stdout));
    const contexts = Array.isArray(value.contexts) ? value.contexts : [];
    for (const context of [
      ...contexts,
      ...list(value.checks).map((entry) => entry.context),
    ])
      if (typeof context === "string") {
        names.add(context);
        found = true;
      }
  }
  if (config.requiredChecks === undefined && (rules.code !== 0 || !found))
    return null;
  return [...names];
}

const HISTORY_PAGE = 100;
const HISTORY_PAGES = 10;

/** Every review and comment, a hundred at a time, up to a thousand of each. */
export function reviewHistory(run: Run, repo: string, number: number) {
  const [owner, name] = repo.split("/");
  const fields = {
    reviews:
      "id author { login } authorAssociation body url submittedAt commit { oid }",
    comments: "id author { login } authorAssociation body url createdAt",
  };
  const result: Record<"reviews" | "comments", Record<string, unknown>[]> = {
    reviews: [],
    comments: [],
  };
  let complete = true;
  for (const kind of ["reviews", "comments"] as const) {
    let after: string | null = null;
    for (let page = 0; ; page++) {
      if (page === HISTORY_PAGES) {
        complete = false;
        break;
      }
      const data = graphql(
        run,
        `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${number}) {
  ${kind}(first: ${HISTORY_PAGE}${after ? `, after: ${JSON.stringify(after)}` : ""}) { pageInfo { hasNextPage endCursor } nodes { ${fields[kind]} } }
} } }`,
      );
      const connection = record(
        record(record(data.repository).pullRequest)[kind],
      );
      if (!Array.isArray(connection.nodes))
        throw new Error(`GitHub returned no ${kind} for #${number}`);
      result[kind].push(...list(connection.nodes));
      const info = record(connection.pageInfo);
      if (info.hasNextPage !== true) break;
      if (typeof info.endCursor !== "string" || !info.endCursor) {
        complete = false;
        break;
      }
      after = info.endCursor;
    }
  }
  return {
    posts: postsOf({
      reviews: { nodes: result.reviews },
      comments: { nodes: result.comments },
    }),
    complete,
  };
}

function copies(
  mirror: string,
  remote: string,
  head: string,
  claims: PullRequestReviewer[],
) {
  const result: Record<string, CopyResult> = {};
  for (const claim of claims) {
    const commit = claim.commit;
    if (!commit || commit === head || result[commit]) continue;
    result[commit] = fetchCommit(mirror, remote, commit)
      ? copyRule(mirror, commit, head)
      : { kind: "unknown", detail: `${commit.slice(0, 7)} not available` };
  }
  return result;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
