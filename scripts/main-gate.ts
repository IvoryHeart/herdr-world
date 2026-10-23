/**
 * Post-merge gate. CI runs on every push to main; when one of those runs
 * fails, this opens an issue naming the merge commit and its PR, and prepares
 * a revert PR for the owner to merge or close. It never merges anything.
 *
 * A batch of merges is tested only at its newest commit (CI supersedes queued
 * main runs), so a red commit names every merge since the last green one and
 * prepares a revert only when it is the sole suspect.
 *
 * One break gets one issue and one revert: while a `main-red` issue is open,
 * later red commits are added to it as comments instead. A green run at or
 * after the red commit closes the issue and its revert PR, so a forgotten
 * issue cannot swallow the next break.
 */

export const MAIN_RED_LABEL = "main-red";

/**
 * Runner and infrastructure failures with a known cause, not code. A red main
 * run whose failed jobs show only these is rerun once before anyone is alerted
 * or a revert is prepared.
 */
export const INFRA_FLAKES = [
  /browser startup timed out after \d+ms/, // first Chrome launch on a fresh runner
  /AssertionError: Invalid control group/, // verification:resources on the runner (#242)
];

/** Jobs that only aggregate other jobs' results. */
const AGGREGATES = new Set(["Delivery checks"]);

/** Lines in a failed step that say nothing beyond the failure itself. */
const NEUTRAL = [
  /^\(pass\) /,
  /^\(fail\) /,
  /exited with code \d+/,
  /^Process completed with exit code \d+/,
  /^$/,
  /^\d+ tests? failed:$/,
  /^\d+ fail$/,
  /^\d+ \|/, // source excerpt in a stack trace
];
const ERRORISH = /error|exceed|fail|assert|panic|refus|denied|mismatch/i;

/**
 * The output of every failed step: each `##[group]Run` section holding an
 * `##[error]` line (a script's exit, or an action's own error), with that
 * annotation prefix removed so its message is judged like any other line.
 */
export function failedStepOutputs(log: string): string[][] {
  const steps: string[][] = [[]];
  for (const raw of log.split("\n")) {
    const line = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").trim();
    if (line.startsWith("##[group]Run ")) steps.push([]);
    steps.at(-1)!.push(line);
  }
  return steps
    .filter((step) => step.some((line) => line.startsWith("##[error]")))
    .map((step) => step.map((line) => line.replace(/^##\[error\]/, "")));
}

/**
 * True when every failed job (aggregates aside) failed only through a known
 * infrastructure flake: each of its failed steps shows that flake, at most one
 * failing test, and no other error of any kind.
 */
export function onlyInfraFlakes(
  failed: Array<{ name: string; log: string }>,
): boolean {
  const jobs = failed.filter((job) => !AGGREGATES.has(job.name));
  return (
    jobs.length > 0 &&
    jobs.every((job) => {
      // Every failed step, including always() steps after the first, must be
      // the flake alone.
      const steps = failedStepOutputs(job.log);
      return (
        steps.length > 0 &&
        steps.every((step) => {
          const tests = new Set(
            step.filter((line) => line.startsWith("(fail) ")),
          );
          const flake = step.some((line) =>
            INFRA_FLAKES.some((pattern) => pattern.test(line)),
          );
          const other = step.some(
            (line) =>
              !line.startsWith("##[group]") &&
              ERRORISH.test(line) &&
              !INFRA_FLAKES.some((pattern) => pattern.test(line)) &&
              !NEUTRAL.some((pattern) => pattern.test(line)),
          );
          return flake && tests.size <= 1 && !other;
        })
      );
    })
  );
}

/** Hidden in the issue body: which commit turned main red. */
export const redShaMarker = (sha: string) => `<!-- main-gate-sha: ${sha} -->`;

export function redShaOf(body: string): string | undefined {
  return /<!-- main-gate-sha: ([0-9a-f]{40}) -->/.exec(body)?.[1];
}

export type MainGateFacts = {
  sha: string;
  runUrl: string;
  owner: string;
  conclusion: "success" | "failure";
  pr?: { number: number; title: string };
  /** The open main-red issue and whether this commit is at or after its red commit. */
  openIssue?: { number: number; redSha?: string; atOrAfterRed: boolean };
  /** A closed main-red issue for this same commit, e.g. a rerun that failed again. */
  closedIssueForSha?: number;
  revertBranchExists: boolean;
  /** Earlier merges since the last green main commit, oldest first; CI skipped them. */
  untested?: Array<{ sha: string; pr?: { number: number; title: string } }>;
  /** Older merges in that range left out of `untested` to keep the list short. */
  omitted?: number;
};

export type MainGatePlan =
  | { kind: "none" }
  | { kind: "comment"; issue: number; body: string }
  | { kind: "resolve"; issue: number; body: string; revertBranch: string }
  | {
      kind: "open";
      reopen?: number;
      issueTitle: string;
      issueBody: string;
      revertBranch: string;
      createRevert: boolean;
      /** Why no revert is prepared: one exists already, or several merges are suspects. */
      revertSkipped?: "exists" | "batch";
      revertTitle: string;
      revertBody: (issue: number) => string;
    };

export function planMainGate(facts: MainGateFacts): MainGatePlan {
  const short = facts.sha.slice(0, 8);
  const revertBranch = `revert/main-${short}`;
  const source = facts.pr
    ? `#${facts.pr.number} (${facts.pr.title})`
    : `commit ${short}`;
  if (facts.conclusion === "success")
    return facts.openIssue?.atOrAfterRed && facts.openIssue.redSha
      ? {
          kind: "resolve",
          issue: facts.openIssue.number,
          body: `main is green again at ${facts.sha}: ${facts.runUrl}. Closing this issue and its prepared revert.`,
          // The revert prepared for this issue's red commit, not for the green one.
          revertBranch: `revert/main-${facts.openIssue.redSha.slice(0, 8)}`,
        }
      : { kind: "none" };
  if (facts.openIssue)
    return {
      kind: "comment",
      issue: facts.openIssue.number,
      body: `main is still red at ${facts.sha}, after ${source}: ${facts.runUrl}`,
    };
  const untested = facts.untested ?? [];
  const omitted = facts.omitted ?? 0;
  const merges = untested.length + omitted + 1;
  const named = (merge: {
    sha: string;
    pr?: { number: number; title: string };
  }) =>
    merge.pr
      ? `#${merge.pr.number} (${merge.pr.title})`
      : `commit ${merge.sha.slice(0, 8)}`;
  const suspects = [
    ...(omitted
      ? [
          `- ${omitted} older merge${omitted === 1 ? "" : "s"} since the last green commit, not listed`,
        ]
      : []),
    ...untested.map((merge) => `- ${named(merge)} at ${merge.sha.slice(0, 8)}`),
    `- ${source} at ${short} (tested)`,
  ];
  return {
    kind: "open",
    reopen: facts.closedIssueForSha,
    issueTitle: untested.length
      ? `main is red at ${short} after ${merges} merges`
      : `main is red at ${short} after ${facts.pr ? `#${facts.pr.number}` : "a direct commit"}`,
    issueBody: [
      untested.length
        ? `@${facts.owner} CI failed on main at ${facts.sha}. It was the newest of ${merges} merges since the last green main commit, and CI tested only it, so any of them may have caused it:`
        : `@${facts.owner} CI failed on main at ${facts.sha}, the merge of ${source}.`,
      ...(untested.length ? ["", ...suspects] : []),
      "",
      `Failed run: ${facts.runUrl}`,
      "",
      "1. If the failure is a known flaky test, rerun the failed jobs. A green run closes this issue and the revert PR.",
      untested.length
        ? "2. Otherwise find the merge that broke it (the failing job usually names its area), then revert or fix it; the next green main run closes this issue. No revert was prepared, because more than one merge is a suspect."
        : "2. Otherwise merge the revert PR (its CI was dispatched) or land a fix; the next green main run closes this issue.",
      "",
      "Releases are cut only from a main commit whose push CI is green (docs/release.md).",
      "",
      redShaMarker(facts.sha),
    ].join("\n"),
    revertBranch,
    createRevert: !facts.revertBranchExists && untested.length === 0,
    revertSkipped: untested.length
      ? "batch"
      : facts.revertBranchExists
        ? "exists"
        : undefined,
    revertTitle: `Revert ${source} (main red at ${short})`,
    revertBody: (issue) =>
      [
        `Reverts ${source}: CI failed on main at ${facts.sha} (${facts.runUrl}).`,
        "",
        `Prepared automatically for #${issue}. Do not merge if a rerun shows the failure was a flake.`,
        "",
        "Changelog: none — reverts an unreleased change.",
      ].join("\n"),
  };
}

async function gh(args: string[], input?: string) {
  const child = Bun.spawn(["gh", ...args], {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [output, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed (${code})`);
  return output.trim();
}

async function git(args: string[]) {
  const child = Bun.spawn(["git", ...args], {
    stdout: "ignore",
    stderr: "inherit",
  });
  return (await child.exited) === 0;
}

async function run() {
  const repo = Bun.env.GITHUB_REPOSITORY!;
  const sha = Bun.env.HEAD_SHA!;
  const conclusion = Bun.env.CONCLUSION === "success" ? "success" : "failure";
  if (conclusion === "failure" && Bun.env.RUN_ATTEMPT === "1") {
    const runId = Bun.env.RUN_ID!;
    const jobs = JSON.parse(
      await gh([
        "api",
        `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
        "--jq",
        '[.jobs[] | select(.conclusion == "failure") | {id, name}]',
      ]),
    ) as Array<{ id: number; name: string }>;
    const failed = [];
    for (const job of jobs)
      failed.push({
        name: job.name,
        log: await gh([
          "api",
          `repos/${repo}/actions/jobs/${job.id}/logs`,
        ]).catch(() => ""),
      });
    if (onlyInfraFlakes(failed)) {
      // The rerun's completion runs this gate again, as attempt 2.
      console.info(`Known infrastructure flake only; rerunning ${runId} once`);
      await gh(["run", "rerun", runId, "--failed"]);
      return;
    }
  }
  const pulls = JSON.parse(
    await gh(["api", `repos/${repo}/commits/${sha}/pulls`]),
  ) as Array<{ number: number; title: string; merge_commit_sha?: string }>;
  // Only the PR whose merge produced this commit; open PRs containing it are not it.
  const pr = pulls.find((pull) => pull.merge_commit_sha === sha);
  const issues = JSON.parse(
    await gh([
      "issue",
      "list",
      "--label",
      MAIN_RED_LABEL,
      "--state",
      "all",
      "--limit",
      "50",
      "--json",
      "number,state,body",
    ]),
  ) as Array<{ number: number; state: string; body: string }>;
  const open = issues.find((issue) => issue.state === "OPEN");
  const redSha = open && redShaOf(open.body);
  await git(["fetch", "--quiet", "origin", "main"]);
  const revertBranch = `revert/main-${sha.slice(0, 8)}`;
  const { merges: untested, omitted } =
    conclusion === "failure" && !open
      ? await untestedMerges(repo, sha)
      : { merges: [], omitted: 0 };
  const plan = planMainGate({
    untested,
    omitted,
    sha,
    runUrl: Bun.env.RUN_URL!,
    owner: Bun.env.GITHUB_REPOSITORY_OWNER!,
    conclusion,
    pr: pr && { number: pr.number, title: pr.title },
    openIssue: open && {
      number: open.number,
      redSha,
      // A late green run of an older commit must not close a newer break.
      atOrAfterRed:
        !!redSha && (await git(["merge-base", "--is-ancestor", redSha, sha])),
    },
    closedIssueForSha: issues.find(
      (issue) => issue.state !== "OPEN" && redShaOf(issue.body) === sha,
    )?.number,
    revertBranchExists: await git([
      "ls-remote",
      "--exit-code",
      "--heads",
      "origin",
      revertBranch,
    ]),
  });
  if (plan.kind === "none") return;
  if (plan.kind === "comment") {
    await gh(
      ["issue", "comment", String(plan.issue), "--body-file", "-"],
      plan.body,
    );
    return;
  }
  if (plan.kind === "resolve") {
    await gh(["issue", "close", String(plan.issue), "--comment", plan.body]);
    const reverts = JSON.parse(
      await gh([
        "pr",
        "list",
        "--state",
        "open",
        "--json",
        "number,headRefName",
      ]),
    ) as Array<{ number: number; headRefName: string }>;
    // Only this issue's revert; another break's revert PR stays for the owner.
    for (const revert of reverts.filter(
      (pull) => pull.headRefName === plan.revertBranch,
    ))
      await gh([
        "pr",
        "close",
        String(revert.number),
        "--delete-branch",
        "--comment",
        `main is green again at ${sha}; this revert is no longer needed.`,
      ]);
    return;
  }
  await gh([
    "label",
    "create",
    MAIN_RED_LABEL,
    "--color",
    "B60205",
    "--description",
    "CI failed on main after a merge",
    "--force",
  ]);
  let issue: number;
  if (plan.reopen !== undefined) {
    issue = plan.reopen;
    await gh(["issue", "reopen", String(issue)]);
    await gh(
      ["issue", "comment", String(issue), "--body-file", "-"],
      `CI failed again on main at ${sha}: ${Bun.env.RUN_URL}`,
    );
  } else {
    const issueUrl = await gh(
      [
        "issue",
        "create",
        "--title",
        plan.issueTitle,
        "--label",
        MAIN_RED_LABEL,
        "--body-file",
        "-",
      ],
      plan.issueBody,
    );
    issue = Number(issueUrl.split("/").pop());
  }
  if (!plan.createRevert) {
    // A batch's issue body already says why no revert was prepared.
    if (plan.revertSkipped === "exists")
      await gh(
        ["issue", "comment", String(issue), "--body-file", "-"],
        `A revert branch for ${sha} already exists: \`${plan.revertBranch}\`. Use its PR, or reopen it.`,
      );
    return;
  }
  const parents = (
    await gh([
      "api",
      `repos/${repo}/commits/${sha}`,
      "--jq",
      ".parents | length",
    ])
  ).trim();
  // Revert on top of current main (the checkout), which may be past `sha`.
  const applied =
    (await git(["switch", "-c", plan.revertBranch])) &&
    (await git(
      parents === "1"
        ? ["revert", "--no-edit", sha]
        : ["revert", "--no-edit", "-m", "1", sha],
    ));
  if (!applied) {
    await gh(
      ["issue", "comment", String(issue), "--body-file", "-"],
      `The automatic revert of ${sha} did not apply cleanly; revert or fix it by hand.`,
    );
    return;
  }
  if (!(await git(["push", "origin", plan.revertBranch])))
    throw new Error("Could not push the revert branch");
  await gh(
    [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      plan.revertBranch,
      "--title",
      plan.revertTitle,
      "--body-file",
      "-",
    ],
    plan.revertBody(issue),
  );
  // Pull requests opened with the workflow token start no workflows.
  await gh(["workflow", "run", "CI", "--ref", plan.revertBranch]);
}

/**
 * First-parent merges between the newest green main commit before `sha` and
 * `sha` itself, oldest first: CI superseded their queued runs.
 */
async function untestedMerges(repo: string, sha: string) {
  const green = (
    await gh([
      "api",
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=50`,
      "--jq",
      ".workflow_runs[].head_sha",
    ])
  ).split("\n");
  let base: string | undefined;
  for (const candidate of green)
    if (
      candidate &&
      candidate !== sha &&
      (await git(["merge-base", "--is-ancestor", candidate, sha]))
    ) {
      base = candidate;
      break;
    }
  // Without a green ancestor on record, name only the tested commit.
  if (!base) return { merges: [], omitted: 0 };
  const child = Bun.spawn(
    ["git", "rev-list", "--first-parent", "--reverse", `${base}..${sha}`],
    { stdout: "pipe", stderr: "inherit" },
  );
  const all = (await new Response(child.stdout).text())
    .split("\n")
    .filter((commit) => commit && commit !== sha);
  // List the newest 20 by name; the issue counts the rest.
  const shas = all.slice(-20);
  const merges = [];
  for (const commit of shas) {
    const pulls = JSON.parse(
      await gh(["api", `repos/${repo}/commits/${commit}/pulls`]),
    ) as Array<{ number: number; title: string; merge_commit_sha?: string }>;
    const pr = pulls.find((pull) => pull.merge_commit_sha === commit);
    merges.push({
      sha: commit,
      pr: pr && { number: pr.number, title: pr.title },
    });
  }
  return { merges, omitted: all.length - shas.length };
}

if (import.meta.main) await run();
