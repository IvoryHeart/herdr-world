/** One infrastructure-only retry; product failures retain their original evidence. */
import { execFileSync } from "node:child_process";

type FailedJob = {
  id: number;
  name: string;
  conclusion: string | null;
  runner_name?: string | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
};

/** @internal */
export function infrastructureFailure(job: FailedJob, log: string): boolean {
  if (job.conclusion !== "failure") return false;
  if (!job.runner_name && !job.steps?.length) return true;
  const failed = job.steps?.find((step) => step.conclusion === "failure");
  const setup =
    /^(Set up job|Set up runner|.*setup-bun.*|.*setup-node.*|.*setup-java.*|.*checkout.*|.*bun install.*|.*[Dd]ownload.*artifact.*)$/.test(
      failed?.name ?? "",
    );
  return (
    (setup &&
      /403|429|5\d\d|ENOTFOUND|ECONNRESET|timed? ?out|not acquired by Runner|failed to download/i.test(
        log,
      )) ||
    /not acquired by Runner|artifact.*(?:ENOTFOUND|ECONNRESET)|(?:download|setup|docker).*(?:ENOTFOUND|ECONNRESET|service unavailable)/i.test(
      log,
    )
  );
}

export async function retryInfrastructure(
  repo: string,
  runId: string,
  attempt: number,
): Promise<boolean> {
  if (attempt !== 1) return false;
  const api = (path: string) =>
    execFileSync("gh", ["api", `repos/${repo}/${path}`], { encoding: "utf8" });
  const jobs: FailedJob[] = JSON.parse(
    api(`actions/runs/${runId}/jobs?per_page=100`),
  ).jobs;
  const failed = jobs.filter((job) => job.conclusion === "failure");
  const retry: number[] = [];
  for (const job of failed) {
    let log = "";
    try {
      log = api(`actions/jobs/${job.id}/logs`);
    } catch {
      /* Runner acquisition may have no log. */
    }
    if (infrastructureFailure(job, log)) retry.push(job.id);
  }
  if (!retry.length) return false;
  // Rerun failed jobs and their dependants once. The new attempt cannot retry.
  execFileSync("gh", ["run", "rerun", runId, "--failed", "--repo", repo], {
    stdio: "inherit",
  });
  console.log(
    `Retried infrastructure failure once (${retry.length} jobs); the issue remains until green.`,
  );
  return true;
}

if (import.meta.main)
  await retryInfrastructure(
    process.env.GITHUB_REPOSITORY!,
    process.env.SOURCE_RUN!,
    Number(process.env.SOURCE_ATTEMPT),
  );
