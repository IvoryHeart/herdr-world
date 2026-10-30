import { appendFileSync } from "node:fs";
import {
  validationProofFromLog,
  sameValidationSelection,
  type ValidationProof,
} from "./ci-validation-proof";
import {
  repositorySelection,
  fullValidationSelection,
  isDocumentationPath,
  type ValidationSelection,
} from "./validation-scope";
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
  validation?: ValidationProof;
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

/** Reuse passing full or identically selected scoped evidence on this exact PR/base/head. */
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
  selection?: ValidationSelection,
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
    if (job.conclusion !== "success") return false;
    if (
      fullStep?.conclusion !== "success" &&
      fullStep?.conclusion !== "skipped"
    )
      return false;
    const source = await testedSourceForJob(job.id);
    // PR associations are mutable; the checkout commit's ordered parents bind
    // the actual tested merge even when the job used a scoped plan.
    if (
      !source ||
      source.checkoutSha !== source.commitSha ||
      source.parents.length !== 2 ||
      source.parents[0] !== baseSha ||
      source.parents[1] !== headSha
    )
      return false;
    if (fullStep.conclusion === "success") return true;
    if (reuseStep?.conclusion !== "success") return false;
    const applicable = job.steps.find(
      ({ name }) => name === "Verify applicable or reused results",
    );
    if (source.validation?.mode === "scoped")
      return (
        applicable?.conclusion === "success" &&
        selection !== undefined &&
        sameValidationSelection(source.validation.selection, selection)
      );
    // Reused successes are not fresh evidence. Older jobs without a proof
    // record cannot establish scoped success, but may lead to a full run.
    if (!source.validation || source.validation.mode === "reuse") continue;
    return false;
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
export { isDocumentationPath } from "./validation-scope";

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

/** Tooling/docs validate afresh; other metadata may reuse exact-revision proof. */
export async function selectValidationMode(
  action: string | undefined,
  docsOnly: boolean,
  reuse: () => Promise<boolean>,
  toolingOnly = false,
  scoped = false,
): Promise<"docs" | "tooling" | "scoped" | "reuse" | "full"> {
  if (toolingOnly) return "tooling";
  if (docsOnly) return "docs";
  const fresh = scoped ? "scoped" : "full";
  if (action !== "edited" && action !== "labeled") return fresh;
  try {
    return (await reuse()) ? "reuse" : fresh;
  } catch (error) {
    console.error(
      `Cannot reuse validation: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fresh;
  }
}

export function writeValidationOutputs(
  output: string,
  mode: string,
  selection: ValidationSelection,
) {
  const active = mode !== "reuse";
  appendFileSync(
    output,
    [
      `mode=${mode}`,
      `selection=${JSON.stringify(selection)}`,
      `world=${active && !!(selection.world.length + selection.web.length)}`,
      `verification=${active && selection.verification}`,
      `packaging=${active && selection.packaging}`,
    ].join("\n") + "\n",
  );
}

if (import.meta.main) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const output = process.env.GITHUB_OUTPUT;
  const headSha = process.env.PR_HEAD_SHA ?? "";
  const baseSha = process.env.PR_BASE_SHA ?? "";
  const jobName = process.env.REQUIRED_JOB_NAME;
  const fullStepName = process.env.REQUIRED_FULL_STEP;
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    if (!output) throw new Error("Missing CI output file");
    writeValidationOutputs(
      output,
      "full",
      fullValidationSelection(process.cwd()),
    );
    process.exit(0);
  }

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
  const common = execFileSync("git", ["merge-base", baseSha, headSha], {
    encoding: "utf8",
  }).trim();
  let selection = repositorySelection(process.cwd(), common, headSha);
  try {
    mode = await selectValidationMode(
      process.env.PR_ACTION,
      selection.documentation,
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
              validation: validationProofFromLog(log),
            };
          },
          selection,
        );
      },
      selection.tooling,
      !selection.full,
    );
  } catch (error) {
    console.error(
      `Cannot shorten validation: ${error instanceof Error ? error.message : String(error)}`,
    );
    selection = fullValidationSelection(process.cwd());
  }
  writeValidationOutputs(output, mode, selection);
  console.log(`${jobName}: ${mode} validation`);
}
