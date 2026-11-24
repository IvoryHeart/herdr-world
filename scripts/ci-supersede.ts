/**
 * CI never cancels a run in flight (ci.yml `cancel-in-progress: false`). When a
 * PR gets a new commit, this cancels the PR's unfinished CI runs that test a
 * different tree, so the queued run starts at once, and keeps a run that tests
 * the identical tree: the queued run then reuses its result instead of
 * restarting it. A run whose tree is not known yet is cancelled, as before.
 */
import { execFileSync } from "node:child_process";
import { checkoutCommitFromLog, SCOPE_JOB } from "./ci-reuse-full-check";

type Run = { id: number; head_sha: string; status: string };
type Job = { id: number; name: string; conclusion: string | null };
type Decision = {
  id: number;
  action: "keep" | "cancel";
  reason: string;
};

/** @internal Decide, for each unfinished run of an older head, whether it is kept. */
export async function supersede(
  runs: Run[],
  headSha: string,
  tree: string,
  testedTree: (runId: number) => Promise<string | undefined>,
): Promise<Decision[]> {
  const decisions: Decision[] = [];
  for (const run of runs) {
    if (run.status === "completed" || run.head_sha === headSha) continue;
    let tested: string | undefined;
    try {
      tested = await testedTree(run.id);
    } catch {
      tested = undefined;
    }
    decisions.push(
      tested === tree
        ? { id: run.id, action: "keep", reason: "tests the identical tree" }
        : {
            id: run.id,
            action: "cancel",
            reason: tested
              ? "tests a different tree"
              : "has not recorded its tree yet",
          },
    );
  }
  return decisions;
}

async function github(
  path: string,
  token: string,
  method = "GET",
): Promise<Response> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response;
}

if (import.meta.main) {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GITHUB_TOKEN ?? "";
  const headRef = process.env.PR_HEAD_REF ?? "";
  const headSha = process.env.PR_HEAD_SHA ?? "";
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !token ||
    !headRef ||
    !/^[0-9a-f]{40}$/.test(headSha)
  )
    throw new Error("Missing CI supersede context");
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  const query = new URLSearchParams({
    event: "pull_request",
    branch: headRef,
    per_page: "30",
  });
  const { workflow_runs: runs } = (await (
    await github(`/repos/${repo}/actions/workflows/ci.yml/runs?${query}`, token)
  ).json()) as { workflow_runs: Run[] };
  const decisions = await supersede(runs, headSha, tree, async (runId) => {
    const { jobs } = (await (
      await github(`/repos/${repo}/actions/runs/${runId}/jobs`, token)
    ).json()) as { jobs: Job[] };
    const scope = jobs.find(({ name }) => name === SCOPE_JOB);
    if (!scope?.conclusion || scope.conclusion === "skipped") return undefined;
    const log = await (
      await github(`/repos/${repo}/actions/jobs/${scope.id}/logs`, token)
    ).text();
    const commit = checkoutCommitFromLog(log);
    if (!commit) return undefined;
    const data = (await (
      await github(`/repos/${repo}/git/commits/${commit}`, token)
    ).json()) as { tree: { sha: string } };
    return data.tree.sha;
  });
  for (const { id, action, reason } of decisions) {
    if (action === "cancel") {
      try {
        await github(`/repos/${repo}/actions/runs/${id}/cancel`, token, "POST");
      } catch (error) {
        // A fork's read-only token cannot cancel; the old run then finishes first.
        console.warn(
          `Cannot cancel run ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }
    console.log(
      `${action === "keep" ? "Kept" : "Cancelled"} run ${id}: it ${reason}.`,
    );
  }
  if (!decisions.length) console.log("No CI run in flight to supersede.");
}
