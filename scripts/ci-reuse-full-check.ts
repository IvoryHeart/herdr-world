import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

type Step = { name: string; conclusion: string | null };
type Job = {
  id: number;
  run_id: number;
  run_attempt: number;
  name: string;
  conclusion: string | null;
  steps: Step[];
};
type TestedSource = {
  checkoutSha: string;
  commitSha: string;
  parents: string[];
};
type Run = {
  id: number;
  run_attempt: number;
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
  testedSourceForJob: (jobId: number) => Promise<TestedSource | undefined>,
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
    if (job.run_id !== run.id || job.run_attempt !== run.run_attempt)
      return false;
    const fullStep = job.steps.find(({ name }) => name === fullStepName);
    const reuseStep = job.steps.find(
      ({ name }) => name === "Determine validation scope",
    );
    if (
      fullStep?.conclusion === "skipped" &&
      reuseStep?.conclusion === "success"
    )
      continue;
    if (job.conclusion !== "success" || fullStep?.conclusion !== "success")
      return false;
    // Run PR associations can change after a base update. The completed job's
    // checkout log and the immutable merge commit's parents bind its source.
    const source = await testedSourceForJob(job.id);
    return (
      source !== undefined &&
      source.checkoutSha === source.commitSha &&
      source.parents.length === 2 &&
      source.parents[0] === baseSha &&
      source.parents[1] === headSha
    );
  }
  return false;
}

/** Read only the checkout action's full commit output; ambiguous logs fail closed. */
export function checkoutCommitFromLog(log: string): string | undefined {
  const lines = log
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").trim());
  const commits = new Set<string>();
  let checkout = false;
  for (let index = 0; index < lines.length - 1; index++) {
    if (lines[index].startsWith("##[group]Run "))
      checkout = lines[index].startsWith("##[group]Run actions/checkout@");
    if (
      checkout &&
      /^\[command\].*\bgit log -1 --format=%H$/.test(lines[index]) &&
      /^[0-9a-f]{40}$/.test(lines[index + 1])
    )
      commits.add(lines[index + 1]);
  }
  return commits.size === 1 ? [...commits][0] : undefined;
}

/**
 * Evidence contracts, execution policy and packaged notices must receive the
 * full candidate gate.
 */
export function isDocumentationPath(path: string): boolean {
  return (
    path.endsWith(".md") &&
    ![
      "verification/",
      "quint/",
      "tools/quint/",
      "openspec/",
      ".agents/",
      ".github/",
    ].some((prefix) => path.startsWith(prefix)) &&
    ![
      "AGENTS.md",
      "CONTRIBUTING.md",
      // Copied into every release package by scripts/package-release.sh.
      "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md",
      "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md",
    ].includes(path)
  );
}

/** Only ordinary documentation changes may use the shorter gate. */
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
  return changed.length > 0 && changed.every(isDocumentationPath);
}

async function githubResponse(path: string, token: string): Promise<Response> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response;
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  return (await (await githubResponse(path, token)).json()) as T;
}

/** Code events validate; metadata events may reuse exact-revision proof. */
export async function selectValidationMode(
  action: string | undefined,
  docsOnly: boolean,
  reuse: () => Promise<boolean>,
): Promise<"docs" | "reuse" | "full"> {
  if (docsOnly) return "docs";
  if (action !== "edited" && action !== "labeled") return "full";
  try {
    return (await reuse()) ? "reuse" : "full";
  } catch (error) {
    console.error(
      `Cannot reuse validation: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "full";
  }
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
    mode = await selectValidationMode(
      process.env.PR_ACTION,
      isDocsOnlyChange(baseSha, headSha),
      async () => {
        const query = new URLSearchParams({
          head_sha: headSha,
          event: "pull_request",
          per_page: "100",
        });
        const { workflow_runs: runs } = await githubJson<{
          workflow_runs: Run[];
        }>(`/repos/${repo}/actions/workflows/ci.yml/runs?${query}`, token);
        return canReuseFullCheck(
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
          async (jobId) => {
            const log = await (
              await githubResponse(
                `/repos/${repo}/actions/jobs/${jobId}/logs`,
                token,
              )
            ).text();
            const commit = checkoutCommitFromLog(log);
            if (!commit) return undefined;
            const data = await githubJson<{
              sha: string;
              parents: Array<{ sha: string }>;
            }>(`/repos/${repo}/git/commits/${commit}`, token);
            return {
              checkoutSha: commit,
              commitSha: data.sha,
              parents: data.parents.map(({ sha }) => sha),
            };
          },
        );
      },
    );
  } catch (error) {
    console.error(
      `Cannot shorten validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  appendFileSync(output, `mode=${mode}\n`);
  console.log(`${jobName}: ${mode} validation`);
}
