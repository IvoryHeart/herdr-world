import { appendFileSync, readFileSync } from "node:fs";
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
import { execFileSync, spawnSync } from "node:child_process";

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
  conclusion: string | null;
  pull_requests: Array<{
    number: number;
    base: { sha: string };
    head: { sha: string };
  }>;
};

/**
 * The ci.yml job and steps that check the description before choosing the scope.
 * @internal
 */
export const SCOPE_JOB = "Validation scope";
/** @internal */
export const DESCRIPTION_STEP = "Check PR description";
/** @internal */
export const SCOPE_STEP = "Determine validation scope";
/**
 * The scope job's step that fails when a title, description or label change
 * meets a head whose latest result is red (mode `hold`).
 * @internal
 */
export const HOLD_STEP = "Hold the head's red result";

/**
 * The run failed only because `check:pr-body` rejected the description: the
 * scope job failed at the description step and never chose a scope, so every
 * code job was skipped and only the report jobs failed after it.
 */
function descriptionOnlyFailure(run: Run, jobs: Job[]): boolean {
  if (run.conclusion !== "failure") return false;
  const scope = jobs.filter(({ name }) => name === SCOPE_JOB);
  if (scope.length !== 1) return false;
  const [job] = scope;
  const step = (name: string) =>
    job.steps.find((step) => step.name === name)?.conclusion;
  return (
    job.run_id === run.id &&
    job.run_attempt === run.run_attempt &&
    job.conclusion === "failure" &&
    step(DESCRIPTION_STEP) === "failure" &&
    step(SCOPE_STEP) === "skipped"
  );
}

/**
 * The run only held its head's red result for a title, description or label
 * change: it tested no code, so like a description failure it neither hides
 * older evidence nor counts as a verdict of its own. Re-running its failed
 * jobs decides again.
 */
function heldResult(run: Run, jobs: Job[]): boolean {
  if (run.conclusion !== "failure") return false;
  const scope = jobs.filter(({ name }) => name === SCOPE_JOB);
  return (
    scope.length === 1 &&
    scope[0].run_id === run.id &&
    scope[0].run_attempt === run.run_attempt &&
    scope[0].steps.find(({ name }) => name === HOLD_STEP)?.conclusion ===
      "failure"
  );
}

/** The run tested no code: its description was refused, or it held a result. */
function testedNothing(run: Run, jobs: Job[]): boolean {
  return descriptionOnlyFailure(run, jobs) || heldResult(run, jobs);
}

/**
 * The head's latest result on this PR is red. A title, description or label
 * change retests nothing, so it holds that red result instead of running the
 * code jobs again (#1373: an edit after an infrastructure failure doubled the
 * PR's macOS demand). Returns the red run's ID. The newest finished run that
 * tested code decides, on any base; a pass, a cancelled run or an unfinished
 * one is no red result to hold, and the event validates as before.
 *
 * @internal
 */
export async function redHeadResult(
  runs: Run[],
  currentRunId: number,
  prNumber: number,
  headSha: string,
  jobsForRun: (runId: number) => Promise<Job[]>,
): Promise<number | undefined> {
  for (const run of [...runs].sort((left, right) => right.id - left.id)) {
    if (
      run.id === currentRunId ||
      run.head_sha !== headSha ||
      !run.pull_requests.some(
        (pr) => pr.number === prNumber && pr.head.sha === headSha,
      )
    )
      continue;
    if (run.conclusion === "failure" || run.conclusion === "timed_out") {
      if (testedNothing(run, await jobsForRun(run.id))) continue;
      return run.id;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Reuse passing full or identically selected scoped evidence on this exact
 * PR/base/head. With `earlierBase`, a metadata event also restores the head's
 * latest verdict when it was tested on an earlier commit of the base branch:
 * the event changed no code, so the status stays what it was before main moved.
 */
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
  earlierBase?: (sha: string) => Promise<boolean>,
): Promise<boolean> {
  for (const run of [...runs].sort((left, right) => right.id - left.id)) {
    if (
      run.id === currentRunId ||
      run.head_sha !== headSha ||
      !run.pull_requests.some(
        (pr) =>
          pr.number === prNumber &&
          (earlierBase !== undefined || pr.base.sha === baseSha) &&
          pr.head.sha === headSha,
      )
    )
      continue;
    const jobs =
      run.conclusion === "success" ? undefined : await jobsForRun(run.id);
    // A run stopped by its PR description, or one that only held the head's
    // red result, tested no code, so it does not hide older evidence; a
    // correction to the description can still reuse it.
    if (jobs && testedNothing(run, jobs)) continue;
    // A failed or unfinished candidate may have no aggregate job at all.
    // Its workflow result is still a barrier to older passing evidence.
    if (run.conclusion !== "success") return false;
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
      source.parents[1] !== headSha
    )
      return false;
    // Any result on this head is the latest verdict, so a red or unrelated
    // one stops the search instead of exposing older evidence.
    const movedBase = source.parents[0] !== baseSha;
    if (movedBase && !(earlierBase && (await earlierBase(source.parents[0]))))
      return false;
    if (fullStep.conclusion === "success") return true;
    if (reuseStep?.conclusion !== "success") return false;
    const applicable = job.steps.find(
      ({ name }) => name === "Verify applicable or reused results",
    );
    // Docs and tooling proofs reach here only for metadata events; their
    // identical selection binds them exactly as a scoped proof does. On an
    // earlier base the selection was right for that merge, and its verdict is
    // restored as it stood rather than re-derived for the new base.
    if (
      source.validation &&
      ["scoped", "docs", "tooling"].includes(source.validation.mode)
    )
      return (
        applicable?.conclusion === "success" &&
        (movedBase ||
          (selection !== undefined &&
            sameValidationSelection(source.validation.selection, selection)))
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

/**
 * A PR `edited` event changed its base branch, not only its title or description.
 * @internal
 */
export function baseChanged(event: unknown): boolean {
  const changes = (event as { changes?: { base?: unknown } } | null)?.changes;
  return changes?.base !== undefined && changes.base !== null;
}

/** @internal */
export const STABILITY_LABEL = "world-browser-stability";

/**
 * A PR `labeled` event added the browser stability label, which requests a
 * fresh stability run.
 * @internal
 */
export function stabilityLabelAdded(event: unknown): boolean {
  const label = (event as { label?: { name?: unknown } } | null)?.label;
  return label?.name === STABILITY_LABEL;
}

/**
 * `older` is the current base commit or one of its ancestors.
 * @internal
 */
export function isEarlierBase(
  older: string,
  current: string,
  cwd = process.cwd(),
): boolean {
  if (!/^[0-9a-f]{40}$/.test(older)) return false;
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", older, current],
    { cwd, encoding: "utf8" },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Cannot compare base commits: ${result.stderr.trim()}`);
}

/**
 * A title or description edit, or a label other than the stability label,
 * changes no tested input, so it reuses the head's passing proof before
 * stability, tooling or docs would validate afresh, and holds the head's red
 * result (`heldRed`) rather than retesting the unchanged code. A new base is a
 * new merge and always validates afresh; so does adding the stability label.
 */
export async function selectValidationMode(
  action: string | undefined,
  docsOnly: boolean,
  reuse: () => Promise<boolean>,
  toolingOnly = false,
  scoped = false,
  stability = false,
  newBase = false,
  stabilityAdded = false,
  heldRed?: () => Promise<boolean>,
): Promise<"docs" | "tooling" | "scoped" | "reuse" | "hold" | "full"> {
  const reusable = async (check = reuse) => {
    try {
      return await check();
    } catch (error) {
      console.error(
        `Cannot reuse validation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };
  const metadata =
    (action === "edited" && !newBase) ||
    (action === "labeled" && !stabilityAdded);
  if (metadata && (await reusable())) return "reuse";
  // An unreadable answer validates, as before: retesting is never unsafe.
  if (metadata && heldRed && (await reusable(heldRed))) return "hold";
  if (stability) return "full";
  if (toolingOnly) return "tooling";
  if (docsOnly) return "docs";
  return scoped ? "scoped" : "full";
}

export function writeValidationOutputs(
  output: string,
  mode: string,
  selection: ValidationSelection,
) {
  const active = mode !== "reuse" && mode !== "hold";
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
  let heldRun: number | undefined;
  const common = execFileSync("git", ["merge-base", baseSha, headSha], {
    encoding: "utf8",
  }).trim();
  const stability = process.env.WORLD_BROWSER_STABILITY === "true";
  let selection = stability
    ? fullValidationSelection(process.cwd())
    : repositorySelection(process.cwd(), common, headSha);
  try {
    const event: unknown = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"),
    );
    const headRuns = async () => {
      const query = new URLSearchParams({
        head_sha: headSha,
        event: "pull_request",
        per_page: "100",
      });
      return (
        await githubJson<{ workflow_runs: Run[] }>(
          `/repos/${repo}/actions/workflows/ci.yml/runs?${query}`,
          token,
        )
      ).workflow_runs;
    };
    const jobsForRun = async (runId: number) =>
      (
        await githubJson<{ jobs: Job[] }>(
          `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
          token,
        )
      ).jobs;
    mode = await selectValidationMode(
      process.env.PR_ACTION,
      selection.documentation,
      async () => {
        const runs = await headRuns();
        return canReuseFullCheck(
          runs,
          currentRunId,
          prNumber,
          baseSha,
          headSha,
          jobName,
          fullStepName,
          jobsForRun,
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
          async (sha) => isEarlierBase(sha, baseSha),
        );
      },
      selection.tooling,
      !selection.full,
      stability,
      baseChanged(event),
      stabilityLabelAdded(event),
      async () => {
        heldRun = await redHeadResult(
          await headRuns(),
          currentRunId,
          prNumber,
          headSha,
          jobsForRun,
        );
        return heldRun !== undefined;
      },
    );
  } catch (error) {
    console.error(
      `Cannot shorten validation: ${error instanceof Error ? error.message : String(error)}`,
    );
    selection = fullValidationSelection(process.cwd());
  }
  writeValidationOutputs(output, mode, selection);
  if (mode === "hold" && heldRun) {
    const url = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${heldRun}`;
    const line = `This head's latest result, run ${heldRun}, is red, and a title, description or label change retests nothing: ${url}. Re-run that run's failed jobs, then this run's failed jobs, or push a commit.`;
    appendFileSync(output, `held_run=${heldRun}\n`);
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }
  console.log(`${jobName}: ${mode} validation`);
}
