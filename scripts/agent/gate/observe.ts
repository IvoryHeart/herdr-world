import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../shared/pullRequestFreshness";
import type { WorkItem } from "../../../shared/worldSources";
import {
  PR_FIELDS,
  parseGitHubResponse,
  record,
} from "../../../server/src/sources/github";
import {
  DETAIL_BATCH,
  detailQuery,
  parseDetails,
} from "../../../server/src/sources/pullRequestDetail";
import {
  copyRule,
  ensureMirror,
  fetchCommit,
  fetchPulls,
  overlap,
} from "./git";
import type {
  CheckAttempt,
  CopyResult,
  GateConfig,
  GateInput,
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
  for (let start = 0; start < items.length; start += DETAIL_BATCH) {
    const chunk = items.slice(start, start + DETAIL_BATCH);
    const details = parseDetails(chunk, graphql(run, detailQuery(chunk)));
    for (const item of chunk) {
      const detail = details.get(item.key);
      if (!detail || !item.headSha) continue;
      item.pr = detail;
      item.prObservation = {
        source: "github",
        state: "fresh",
        headSha: item.headSha,
        readAt: now,
        expiresAt: now + PULL_REQUEST_DETAIL_MAX_AGE_MS,
      };
    }
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
    const base = {
      number,
      state,
      labels: labels.get(number) ?? [],
      attempts: [],
      copies: {},
      hold: null,
      overlap: null,
      readAt: now,
    } satisfies GateInput;
    if (!item?.headSha)
      return state === "OPEN" && item ? { ...base, item } : base;
    return {
      ...base,
      item,
      attempts: earlierAttempts(run, config.repo, item.headSha),
      copies: copies(mirror, remote, item),
      overlap: overlap(mirror, item.headSha),
    };
  });
}

function copies(mirror: string, remote: string, item: WorkItem) {
  const result: Record<string, CopyResult> = {};
  for (const reviewer of item.pr?.reviewers ?? []) {
    const commit = reviewer.commit;
    if (!commit || commit === item.headSha || result[commit]) continue;
    result[commit] = fetchCommit(mirror, remote, commit)
      ? copyRule(mirror, commit, item.headSha!)
      : { kind: "unknown", detail: `${commit.slice(0, 7)} not available` };
  }
  return result;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
