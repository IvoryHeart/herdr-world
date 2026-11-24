/** Resolve the sealed candidate automatically; no cross-run authorization. */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

type Run = {
  id: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
};
type Artifact = { id: number; name: string; expired: boolean };

/** @internal */
export function mainRun(runs: Run[], sha: string): Run | undefined {
  return runs
    .filter(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === "main" &&
        run.event === "push",
    )
    .sort((a, b) => b.id - a.id)[0];
}

/** @internal */
export function sealedArtifact(artifacts: Artifact[]): Artifact | undefined {
  const bundles = artifacts.filter(
    (artifact) => artifact.name === "verified-release" && !artifact.expired,
  );
  if (bundles.length > 1) throw new Error("Ambiguous sealed release artifacts");
  return bundles[0];
}

/** Eventual main CI selection; injectable clock/wait makes every transition testable. */
/** @internal */
export async function waitForMain(
  sha: string,
  readRuns: () => Promise<Run[]>,
  wait = () => delay(30_000),
  now = Date.now,
) {
  const deadline = now() + 350 * 60 * 1000;
  // Pipeline wait includes queueing and the single infrastructure retry.
  let run: Run | undefined;
  let firstFailure: number | undefined;
  while (now() < deadline) {
    run = mainRun(await readRuns(), sha);
    if (run?.status === "completed") {
      if (run.conclusion === "success") break;
      firstFailure ??= now();
      if (run.run_attempt > 1 || now() - firstFailure > 180_000)
        throw new Error(
          "Main CI failed; re-run the failed main jobs, then re-run this tag",
        );
    }
    await wait();
  }
  if (!run || run.status !== "completed" || run.conclusion !== "success")
    throw new Error(
      "Main CI wait timed out; re-running this tag resumes the wait",
    );
  return run;
}

export async function releaseWalkGate(sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("Require exact release commit");
  const repo = process.env.GITHUB_REPOSITORY!;
  const api = (path: string) =>
    JSON.parse(
      execFileSync("gh", ["api", `repos/${repo}/${path}`], {
        encoding: "utf8",
      }),
    );
  const run = await waitForMain(
    sha,
    async () =>
      api(
        `actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,
      ).workflow_runs,
  );
  const artifact = sealedArtifact(
    api(`actions/runs/${run.id}/artifacts?per_page=100`).artifacts,
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `run=${run.id}\nartifact=${artifact?.id ?? ""}\nrebuild=${!artifact}\n`,
    );
  console.log(
    artifact
      ? "Main CI passed; publishing its sealed bytes"
      : "Seal expired; rebuilding and testing every release contract before publication",
  );
}

if (import.meta.main) {
  try {
    await releaseWalkGate(process.argv[2]!);
  } catch (error) {
    console.error(`::error::${(error as Error).message}`);
    process.exitCode = 1;
  }
}
