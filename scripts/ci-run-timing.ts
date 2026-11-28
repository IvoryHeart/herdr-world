import { appendFileSync, readFileSync } from "node:fs";

/** @internal */
export type TimingJob = {
  name: string;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};
type TimingRun = { created_at: string; html_url: string };
type Workflow = {
  jobs: Record<
    string,
    { name?: string; needs?: string | string[]; uses?: string }
  >;
};

const stamp = (value: string | null) => (value ? Date.parse(value) : NaN);
const duration = (start: string | null, end: string | null) => {
  const seconds = (stamp(end) - stamp(start)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};
const seconds = (value: number | null) => {
  if (value === null) return "unknown";
  const whole = Math.round(value);
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`;
};
const label = (value: string) => value.replace(/[|`<>\r\n]/g, " ");

// GitHub resolves matrix expressions in job names. Reusable workflow leaves
// carry the caller's name as a prefix, so their latest completion owns the join.
function matches(name: string, template: string) {
  const parts = template.split(/\$\{\{.*?\}\}/);
  const pattern = parts
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}(?: / .*)?$`).test(name);
}

/** Observed dependency path: follow the last-completing predecessor at each
 * join. A long runner queue can make this differ from the longest execution.
 * @internal
 */
export function renderRunTiming(
  run: TimingRun,
  jobs: TimingJob[],
  workflow: Workflow,
  observedAt: string,
) {
  const active = jobs.filter((job) => job.conclusion !== "skipped");
  const end = (job: TimingJob) => job.completed_at ?? observedAt;
  const latest = (candidates: TimingJob[]) =>
    candidates
      .filter((job) => Number.isFinite(stamp(end(job))))
      .sort((a, b) => stamp(end(b)) - stamp(end(a)))[0];
  const groups = new Map(
    Object.entries(workflow.jobs).map(([id, definition]) => [
      id,
      {
        definition,
        last: latest(
          active.filter((job) => matches(job.name, definition.name ?? id)),
        ),
      },
    ]),
  );
  const chain = (id: string, seen = new Set<string>()): string[] => {
    const group = groups.get(id);
    if (!group?.last || seen.has(id)) return [];
    const nextSeen = new Set([...seen, id]);
    const needs =
      typeof group.definition.needs === "string"
        ? [group.definition.needs]
        : (group.definition.needs ?? []);
    const predecessor = needs
      .filter((need) => groups.get(need)?.last)
      .sort(
        (a, b) =>
          stamp(end(groups.get(b)!.last!)) - stamp(end(groups.get(a)!.last!)),
      )[0];
    return [
      ...(predecessor ? chain(predecessor, nextSeen) : []),
      label(group.last.name),
    ];
  };
  const delivery = groups.get("delivery")?.last;
  const measured = active.map((job) => ({
    job,
    execution: duration(job.started_at, end(job)),
    // created_at is the job's queue entry, not the workflow's creation time.
    wait: duration(job.created_at, job.started_at),
  }));
  const longest = measured
    .filter((row) => row.execution !== null)
    .sort((a, b) => b.execution! - a.execution!)[0];
  const waits = measured.filter((row) => row.wait !== null);
  const longestWait = [...waits].sort((a, b) => b.wait! - a.wait!)[0];
  const lines = [
    "### Run timings",
    "",
    `Run created: ${run.created_at}; observed: ${observedAt}.`,
    "",
  ];
  if (delivery) {
    lines.push(
      `- Critical path (run created → Delivery ${delivery.completed_at ? "completed" : "report"}): **${seconds(duration(run.created_at, end(delivery)))}**`,
    );
    lines.push(
      `- Dependency path (reusable workflows show their last leaf): ${chain("delivery").join(" → ")}`,
    );
    if (!delivery.completed_at)
      lines.push(
        "- Final created_at → Delivery completed_at is available after this job exits; this report is a lower bound.",
      );
  } else
    lines.push(
      "- Critical path: unavailable (Delivery job timestamps missing).",
    );
  lines.push(
    longest
      ? `- Longest job: **${label(longest.job.name)}** — ${seconds(longest.execution)}${longest.job.completed_at ? "" : " (in progress)"}`
      : "- Longest job: unknown.",
  );
  lines.push(
    longestWait
      ? `- Runner waits: **${seconds(waits.reduce((sum, row) => sum + row.wait!, 0))}** across ${waits.length} jobs; longest **${label(longestWait.job.name)}** — ${seconds(longestWait.wait)}`
      : "- Runner waits: unknown.",
  );
  lines.push(
    "",
    "Runner waits sum job created_at → started_at (parallel waits overlap); dependency waits before a job is created are excluded. Skipped jobs are excluded. Missing timestamps stay unknown.",
    "",
    `Executed jobs: **${active.length}** (matrix expansions included).`,
    "",
    "| Job | Result | Execution | Runner wait | Start offset | End offset |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  );
  for (const row of measured)
    lines.push(
      `| ${label(row.job.name)} | ${row.job.conclusion ?? "in progress"} | ${seconds(row.execution)} | ${seconds(row.wait)} | ${seconds(duration(run.created_at, row.job.started_at))} | ${seconds(duration(run.created_at, end(row.job)))} |`,
    );
  return lines.join("\n") + "\n";
}

/** @internal */
export async function collectRunTiming(
  repository: string,
  runId: string,
  attempt: string,
  api: (path: string) => Promise<unknown>,
) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^[1-9]\d*$/.test(runId) ||
    !/^[1-9]\d*$/.test(attempt)
  )
    throw new Error("Invalid run identity");
  const base = `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}`;
  const run = (await api(base)) as TimingRun;
  const jobs: TimingJob[] = [];
  // Pagination is bounded; this is a single observation, never a status wait.
  for (let page = 1; page <= 5; page++) {
    const result = (await api(`${base}/jobs?per_page=100&page=${page}`)) as {
      jobs: TimingJob[];
    };
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) return { run, jobs };
  }
  throw new Error("Timing job limit exceeded");
}

if (import.meta.main) {
  let report: string;
  try {
    const { run, jobs } = await collectRunTiming(
      process.env.GITHUB_REPOSITORY!,
      process.env.GITHUB_RUN_ID!,
      process.env.GITHUB_RUN_ATTEMPT!,
      async (path) => {
        const response = await fetch(`https://api.github.com${path}`, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${process.env.GH_TOKEN}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
          throw new Error(`GitHub timing API: ${response.status}`);
        return response.json();
      },
    );
    const workflow = Bun.YAML.parse(
      readFileSync(
        new URL("../.github/workflows/ci.yml", import.meta.url),
        "utf8",
      ),
    ) as Workflow;
    report = renderRunTiming(run, jobs, workflow, new Date().toISOString());
  } catch {
    // Reporting cannot change a test verdict. Never print API bodies or tokens.
    report =
      "### Run timings\n\nTiming data unavailable for this attempt (GitHub API or timestamp data unavailable). Check the Actions jobs timeline.\n";
    console.warn(
      "::warning::Run timings unavailable; validation results are unchanged",
    );
  }
  console.info(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
