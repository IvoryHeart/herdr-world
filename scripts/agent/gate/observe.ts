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
import {
  latestChecks,
  type CheckAttempt,
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

/** Earlier attempts of each workflow run on `head`; the latest is in the rollup. */
export function earlierAttempts(
  run: Run,
  repo: string,
  head: string,
): CheckAttempt[] {
  const runs = list(
    restJson(run, `repos/${repo}/actions/runs?head_sha=${head}&per_page=100`)
      .workflow_runs,
  );
  const attempts: CheckAttempt[] = [];
  for (const entry of runs) {
    const runId = Number(entry.id);
    const latest = Number(entry.run_attempt);
    if (!Number.isSafeInteger(runId) || !(latest > 1)) continue;
    for (let attempt = 1; attempt < latest; attempt++) {
      const jobs = list(
        restJson(
          run,
          `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
        ).jobs,
      );
      for (const job of jobs)
        if (typeof job.name === "string")
          attempts.push({
            runId,
            attempt,
            name: job.name,
            conclusion:
              typeof job.conclusion === "string" ? job.conclusion : "unknown",
            completedAt: Date.parse(String(job.completed_at)) || 0,
          });
    }
  }
  return attempts;
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
      // The list's summary is older than the detail; the worse one stands.
      item.checks = worse(item.checks ?? "none", summary(detail.checks));
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
      overlap: null,
      readAt: now,
    };
    if (!item?.headSha || !item.pr)
      return state === "OPEN" && item ? { ...base, item } : base;
    const head = item.headSha;
    const branch = item.base ?? "main";
    if (!inventories.has(branch))
      inventories.set(branch, requiredInventory(run, config, branch));
    const required = inventories.get(branch)!;
    const flagged = item.pr.checks
      .filter((check) => check.required)
      .map((check) => check.name);
    const evidence = reviewHistory(run, config.repo, number);
    const commits = commitsOf.get(number) ?? [];
    const posts = trustedPosts(evidence.posts);
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
      historyComplete: evidence.complete,
      requiredChecks: required && [...new Set([...required, ...flagged])],
      attempts: earlierAttempts(run, config.repo, head),
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

function summary(all: PullRequestCheck[]): WorkChecks {
  const checks = latestChecks(all).latest;
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
