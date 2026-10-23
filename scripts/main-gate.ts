/**
 * Post-merge gate. CI runs on every push to main; when one of those runs
 * fails, this opens an issue naming the merge commit and its PR, and prepares
 * a revert PR for the owner to merge or close. It never merges anything.
 *
 * One break gets one issue and one revert: while a `main-red` issue is open,
 * later red commits are added to it as comments instead. A green run at or
 * after the red commit closes the issue and its revert PR, so a forgotten
 * issue cannot swallow the next break.
 */

export const MAIN_RED_LABEL = "main-red";

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
  return {
    kind: "open",
    reopen: facts.closedIssueForSha,
    issueTitle: `main is red at ${short} after ${facts.pr ? `#${facts.pr.number}` : "a direct commit"}`,
    issueBody: [
      `@${facts.owner} CI failed on main at ${facts.sha}, the merge of ${source}.`,
      "",
      `Failed run: ${facts.runUrl}`,
      "",
      "1. If the failure is a known flaky test, rerun the failed jobs. A green run closes this issue and the revert PR.",
      "2. Otherwise merge the revert PR (its CI was dispatched) or land a fix; the next green main run closes this issue.",
      "",
      "Releases are cut only from a main commit whose push CI is green (docs/release.md).",
      "",
      redShaMarker(facts.sha),
    ].join("\n"),
    revertBranch,
    createRevert: !facts.revertBranchExists,
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
  const plan = planMainGate({
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

if (import.meta.main) await run();
