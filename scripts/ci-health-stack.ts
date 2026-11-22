import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildGraph } from "./affected";
import { readCoverageScope } from "./coverage-scope";
import { selectValidation } from "./validation-scope";
import { github, type Job, type Run } from "./ci-health-github";
import worldTimings from "./world-browser-timings.json";

export function runCost(run: Run, jobs: Job[]) {
  const active = jobs.filter((job) => job.conclusion !== "skipped");
  assert(
    active.every((job) => job.started_at && job.completed_at),
    "Incomplete job timing",
  );
  return {
    jobs: active.length,
    runnerMinutes:
      active.reduce(
        (sum, job) =>
          sum + Date.parse(job.completed_at!) - Date.parse(job.started_at!),
        0,
      ) / 60000,
    resultMinutes:
      (Date.parse(run.updated_at) - Date.parse(run.created_at)) / 60000,
  };
}

/** One completed reference run, with explicit projections rather than invented
 * after measurements. Run again on the delivered CI run to obtain actuals.
 */
export function stackReport(repo: string, id: string, root = process.cwd()) {
  assert(
    /^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(repo),
    "Invalid repository",
  );
  assert(/^[1-9]\d*$/.test(id), "Invalid reference run ID");
  const run = github([`repos/${repo}/actions/runs/${id}`]) as Run;
  const response = github([
    `repos/${repo}/actions/runs/${id}/jobs?per_page=100&filter=latest`,
  ]) as { total_count: number; jobs: Job[] };
  assert(
    response.total_count <= 100 && run.conclusion === "success",
    "Need a complete successful reference run",
  );
  const cost = runCost(run, response.jobs);
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString()
    .split("\0")
    .filter(Boolean);
  const graph = buildGraph(root, paths);
  const coverage = readCoverageScope(root, "origin/main");
  const duration = (pattern: RegExp) =>
    response.jobs
      .filter(
        (job) => pattern.test(job.name) && job.started_at && job.completed_at,
      )
      .reduce(
        (sum, job) =>
          sum + Date.parse(job.completed_at!) - Date.parse(job.started_at!),
        0,
      ) / 60000;
  const stepMinutes = (pattern: RegExp) =>
    response.jobs
      .flatMap((job) => job.steps)
      .filter(
        (step) =>
          pattern.test(step.name) && step.started_at && step.completed_at,
      )
      .reduce(
        (sum, step) =>
          sum + Date.parse(step.completed_at!) - Date.parse(step.started_at!),
        0,
      ) / 60000;
  const lines = [
    `Reference ${run.html_url}: ${cost.runnerMinutes.toFixed(2)} runner-minutes; ${cost.jobs} active jobs; ${cost.resultMinutes.toFixed(2)} minutes to result (includes queue).`,
    "After scope projections below use this checkout's selector and retained World file timings. Full-unit/web/native durations and serial World work are planning estimates, not measured after results. Browser concurrency, caching overhead and hosted queue variance require the delivered CI run.",
    "Workload | before full reference (runner-min/jobs/result-min) | after planning estimate (runner-min/jobs) | content-hit savings (runner-min)",
  ];
  for (const [name, path] of [
    ["web-only", "web/src/instanceName.ts"],
    ["server-only", "server/src/agent/conversation.ts"],
    ["install-touching", "scripts/install-herdr-world.sh"],
  ]) {
    const selection = selectValidation(
      graph,
      [path!],
      coverage.owns,
      [path!],
      coverage.models,
    );
    // Scope, static, two unit shards, repository aggregate, protected macOS
    // reports and Delivery are always active for these representative inputs.
    let jobs = 8;
    let minutes = duration(
      /^(?:Validation scope|Static checks|Non-browser tests|Repository validation|Delivery checks|macOS launchd plugin lifecycle)/,
    );
    // Current protected macOS reports take Ubuntu and only aggregate; remove
    // the old native work from this conservative comparison. It still runs
    // inside each selected Darwin installer job and is added below.
    const lifecycle = duration(/^macOS launchd plugin lifecycle/);
    minutes -= lifecycle;
    const browser = selection.world.length + selection.web.length > 0;
    if (browser) {
      jobs += selection.worldShards.length + (selection.web.length ? 3 : 0);
      minutes += selection.world.reduce((sum, path) => {
        const name = path
          .replace("web/src/world/", "")
          .replace(".test.ts", "") as keyof typeof worldTimings.seconds;
        return sum + worldTimings.seconds[name] / 60;
      }, 0);
      if (selection.web.length)
        minutes += duration(/World browser tests \/ Web browser/);
    }
    if (selection.verification) {
      jobs += 4;
      minutes += duration(/^Behavioral verification/);
    }
    if (selection.packaging) {
      jobs += 6;
      minutes +=
        duration(/Installer upgrade \(/) +
        lifecycle +
        2 * duration(/^Windows Bun-free plugin installation/);
    }
    const modelSaving = selection.verification
      ? stepMinutes(/Run all accepted models within enforced resource limits/)
      : 0;
    const buildSaving = selection.packaging
      ? stepMinutes(
          /Build the proposed merge with the release packaging script/,
        )
      : 0;
    lines.push(
      `${name} (${path}) | ${cost.runnerMinutes.toFixed(2)}/${cost.jobs}/${cost.resultMinutes.toFixed(2)} | ${minutes.toFixed(2)}/${jobs} | up to ${modelSaving.toFixed(2)} models + ${buildSaving.toFixed(2)} native builds (before cache overhead)`,
    );
  }
  lines.push(
    "After time-to-result: unmeasured until the delivered run; targets are median 8 minutes and about 10 jobs for a web-only PR, not guarantees. Projections do not assume selected units run for zero time or that native assertions disappear on build-cache hits.",
  );
  return lines.join("\n");
}
