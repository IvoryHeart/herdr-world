import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

type Step = { name: string; conclusion: string | null };
type Job = { name: string; conclusion: string | null; steps: Step[] };
type Run = {
  id: number;
  head_sha: string;
  pull_requests: Array<{
    number: number;
    base: { sha: string };
    head: { sha: string };
  }>;
};

/** A metadata edit may reuse only a successful full job on this exact PR/base/head. */
export async function canReuseFullCheck(
  runs: Run[],
  currentRunId: number,
  prNumber: number,
  baseSha: string,
  headSha: string,
  jobName: string,
  fullStepName: string,
  jobsForRun: (runId: number) => Promise<Job[]>,
): Promise<boolean> {
  for (const run of [...runs].sort((left, right) => right.id - left.id)) {
    if (
      run.id === currentRunId ||
      run.head_sha !== headSha ||
      !run.pull_requests.some(
        (pr) =>
          pr.number === prNumber &&
          pr.base.sha === baseSha &&
          pr.head.sha === headSha,
      )
    )
      continue;
    const job = (await jobsForRun(run.id)).find(({ name }) => name === jobName);
    if (!job) continue;
    const fullStep = job.steps.find(({ name }) => name === fullStepName);
    const reuseStep = job.steps.find(
      ({ name }) => name === "Determine validation scope",
    );
    if (
      fullStep?.conclusion === "skipped" &&
      reuseStep?.conclusion === "success"
    )
      continue;
    return job.conclusion === "success" && fullStep?.conclusion === "success";
  }
  return false;
}

/** Only Markdown changes in the PR require the shorter documentation gate. */
export function isDocsOnlyChange(
  baseSha: string,
  headSha: string,
  cwd = process.cwd(),
): boolean {
  const common = execFileSync("git", ["merge-base", baseSha, headSha], {
    encoding: "utf8",
    cwd,
  }).trim();
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "-z", "--no-renames", common, headSha],
    { encoding: "utf8", cwd },
  )
    .split("\0")
    .filter(Boolean);
  return changed.length > 0 && changed.every((path) => path.endsWith(".md"));
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return (await response.json()) as T;
}

if (import.meta.main) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const output = process.env.GITHUB_OUTPUT;
  const headSha = process.env.PR_HEAD_SHA ?? "";
  const baseSha = process.env.PR_BASE_SHA ?? "";
  const jobName = process.env.REQUIRED_JOB_NAME;
  const fullStepName = process.env.REQUIRED_FULL_STEP;
  const prNumber = Number(process.env.PR_NUMBER);
  const currentRunId = Number(process.env.GITHUB_RUN_ID);
  if (
    !repo?.match(/^[\w.-]+\/[\w.-]+$/) ||
    !token ||
    !output ||
    !/^[0-9a-f]{40}$/.test(headSha) ||
    !/^[0-9a-f]{40}$/.test(baseSha) ||
    !jobName ||
    !fullStepName ||
    !Number.isSafeInteger(prNumber) ||
    !Number.isSafeInteger(currentRunId)
  )
    throw new Error("Missing CI reuse context");

  let mode = "full";
  try {
    if (isDocsOnlyChange(baseSha, headSha)) {
      mode = "docs";
    } else if (process.env.PR_ACTION === "edited") {
      const query = new URLSearchParams({
        head_sha: headSha,
        event: "pull_request",
        per_page: "100",
      });
      const { workflow_runs: runs } = await githubJson<{
        workflow_runs: Run[];
      }>(`/repos/${repo}/actions/workflows/ci.yml/runs?${query}`, token);
      if (
        await canReuseFullCheck(
          runs,
          currentRunId,
          prNumber,
          baseSha,
          headSha,
          jobName,
          fullStepName,
          async (runId) =>
            (
              await githubJson<{ jobs: Job[] }>(
                `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
                token,
              )
            ).jobs,
        )
      )
        mode = "reuse";
    }
  } catch (error) {
    console.error(
      `Cannot shorten validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  appendFileSync(output, `mode=${mode}\n`);
  console.log(`${jobName}: ${mode} validation`);
}
