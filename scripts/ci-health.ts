import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { collectHealth, type HealthData } from "./ci-health-github";
import { deliveryLines, percentile } from "./ci-health-delivery";

const minutes = (value: number | undefined) =>
  value === undefined ? "n/a" : `${(value / 60_000).toFixed(1)}m`;
const delta = (start: string, end: string) =>
  Date.parse(end) - Date.parse(start);
const pair = (values: number[]) =>
  `${minutes(percentile(values, 0.5))}/${minutes(percentile(values, 0.9))}`;
const percent = (part: number, total: number) =>
  total ? `${((100 * part) / total).toFixed(1)}%` : "n/a";

export function healthReport(data: HealthData, since: Date, now: Date): string {
  const prs = data.runs.filter(
    (run) => run.name === "CI" && run.event === "pull_request",
  );
  const count = (result: string) =>
    prs.filter((run) => run.conclusion === result).length;
  const green = prs
    .filter((run) => run.conclusion === "success")
    .map((run) => delta(run.created_at, run.updated_at));
  const completed = prs
    .filter((run) => ["success", "failure"].includes(run.conclusion || ""))
    .map((run) => delta(run.created_at, run.updated_at));
  const jobs = new Map<string, number[]>();
  const queues = new Map<string, number[]>();
  const failed = new Map<string, number>();
  const jobCounts: number[] = [];
  const platformRuns = new Set<number>();
  const greenPlatformRuns = new Set<number>();
  const aggregates = new Set([
    "Run full repository check",
    "Verify applicable or reused results",
    "Require static checks and applicable unit shards",
    'Run test "$RESULT" = success',
  ]);
  for (const sample of data.jobs) {
    if (sample.run.name !== "CI" || sample.run.event !== "pull_request")
      continue;
    jobCounts.push(
      sample.jobs.filter((job) => job.conclusion !== "skipped").length,
    );
    if (
      sample.jobs.some(
        (job) =>
          /Installer upgrade \(/.test(job.name) && job.conclusion !== "skipped",
      )
    ) {
      platformRuns.add(sample.run.id);
      if (sample.run.conclusion === "success")
        greenPlatformRuns.add(sample.run.id);
    }
    for (const job of sample.jobs) {
      if (job.conclusion === "success" && job.started_at && job.completed_at)
        jobs.set(job.name, [
          ...(jobs.get(job.name) ?? []),
          delta(job.started_at, job.completed_at),
        ]);
      if (
        job.conclusion !== "skipped" &&
        job.started_at &&
        job.created_at &&
        job.labels.length
      ) {
        const runner = job.labels.join(",");
        queues.set(runner, [
          ...(queues.get(runner) ?? []),
          Math.max(0, delta(job.created_at, job.started_at)),
        ]);
      }
      const step = job.steps.find((step) => step.conclusion === "failure");
      if (step && !aggregates.has(step.name))
        failed.set(step.name, (failed.get(step.name) ?? 0) + 1);
    }
  }
  const ciSamples = data.jobs.filter(
    (sample) => sample.run.name === "CI" && sample.run.event === "pull_request",
  ).length;
  const slow = [...jobs]
    .sort((a, b) => (percentile(b[1], 0.5) ?? 0) - (percentile(a[1], 0.5) ?? 0))
    .slice(0, 4);
  const queue = [...queues]
    .sort((a, b) => (percentile(b[1], 0.9) ?? 0) - (percentile(a[1], 0.9) ?? 0))
    .slice(0, 4);
  const attempts = data.attempts.filter(
    (run) => run.conclusion && run.conclusion !== "cancelled",
  );
  const lines = [
    `CI health ${since.toISOString().slice(0, 16)}Z → ${now.toISOString().slice(0, 16)}Z (${data.requests}/100 requests)`,
    `PR CI n=${prs.length}: pass ${count("success")} (${percent(count("success"), prs.length)}), fail ${count("failure")} (${percent(count("failure"), prs.length)}), cancel ${count("cancelled")} (${percent(count("cancelled"), prs.length)}), other/active ${prs.length - count("success") - count("failure") - count("cancelled")}`,
    `Push/event → green p50/p90 ${pair(green)}, max ${minutes(percentile(green, 1))} (queue + dependencies + execution; n=${green.length})`,
    `Push/event → pass or fail p50/p90 ${pair(completed)} (n=${completed.length}; cancellations excluded)`,
    `Unchanged-commit rerun attempts: ${attempts.filter((run) => run.conclusion === "success").length}/${attempts.length} green; 49/50 target ${attempts.length < 50 ? "unproven (<50 observations)" : percent(attempts.filter((run) => run.conclusion === "success").length, attempts.length)}`,
    `Active jobs/run median ${percentile(jobCounts, 0.5) ?? "n/a"}; installer selected ${platformRuns.size}/${ciSamples} sampled PRs, ${greenPlatformRuns.size}/${data.jobs.filter(({ run }) => run.name === "CI" && run.event === "pull_request" && run.conclusion === "success").length} green`,
    ...slow.map(
      ([name, values]) =>
        `Slow job ${name}: p50/p90 ${pair(values)} (n=${values.length})`,
    ),
    ...queue.map(
      ([name, values]) =>
        `Runner wait ${name}: p50/p90 ${pair(values)}, max ${minutes(percentile(values, 1))} (n=${values.length})`,
    ),
    `Failing leaf steps (first per job, sample): ${
      [...failed]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => `${count}× ${name}`)
        .join("; ") || "none"
    }`,
  ];
  const main = data.runs
    .filter(
      (run) =>
        run.name === "CI" &&
        run.event === "push" &&
        run.conclusion === "success",
    )
    .map((run) => delta(run.created_at, run.updated_at));
  lines.push(
    `Main CI: green p50/p90 ${pair(main)}, max ${minutes(percentile(main, 1))} (n=${main.length}; includes rerun delay)`,
  );
  for (const name of ["Deploy Pages", "World latency trend"]) {
    const values = data.runs
      .filter((run) => run.name === name && run.conclusion === "success")
      .map((run) => delta(run.created_at, run.updated_at));
    lines.push(
      `${name}: green p50/p90 ${pair(values)}, max ${minutes(percentile(values, 1))} (n=${values.length})`,
    );
  }
  lines.push(...deliveryLines(data, since, now));
  lines.push(
    `Limits: ${data.limits.join("; ") || "inventories within caps"}. First-commit dates use PR commit metadata; failure attribution needs explicit links.`,
  );
  return lines.join("\n");
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        days: { type: "string", default: "3" },
        repo: { type: "string" },
      },
      strict: true,
    });
    const days = Number(values.days);
    if (!Number.isInteger(days) || days < 1 || days > 30)
      throw new Error("--days must be an integer from 1 to 30");
    const configuredRepo = values.repo ?? process.env.GH_REPO;
    const repo =
      configuredRepo ??
      execFileSync(
        "gh",
        ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        { encoding: "utf8", timeout: 30_000 },
      ).trim();
    const now = new Date();
    const since = new Date(+now - days * 86_400_000);
    const data = collectHealth(repo, since);
    if (!configuredRepo) data.requests++;
    console.info(healthReport(data, since, now));
  } catch (error) {
    // gh may include response content in stderr. Keep account data and tokens out
    // of errors; the owner can diagnose authentication with gh auth status.
    console.error(
      error instanceof Error && !("status" in error)
        ? error.message
        : "GitHub health read failed; check gh authentication, repository access and API limits.",
    );
    process.exitCode = 1;
  }
}
