/**
 * Post-merge gate. CI runs on every push to main; when one of those runs
 * fails, this opens an issue naming the merge commit and its PR, and prepares
 * a revert PR for the owner to merge or close. It never merges anything.
 *
 * One break gets one issue and one revert: while a `main-red` issue is open,
 * later red commits are added to it as comments instead.
 */

export const MAIN_RED_LABEL = "main-red";

export type MainGateFacts = {
  sha: string;
  runUrl: string;
  owner: string;
  pr?: { number: number; title: string };
  openIssue?: number;
};

export type MainGatePlan =
  | { kind: "comment"; issue: number; body: string }
  | {
      kind: "open";
      issueTitle: string;
      issueBody: string;
      revertBranch: string;
      revertTitle: string;
      revertBody: (issue: number) => string;
    };

export function planMainGate(facts: MainGateFacts): MainGatePlan {
  const short = facts.sha.slice(0, 8);
  const source = facts.pr
    ? `#${facts.pr.number} (${facts.pr.title})`
    : `commit ${short}`;
  if (facts.openIssue !== undefined)
    return {
      kind: "comment",
      issue: facts.openIssue,
      body: `main is still red at ${facts.sha}, after ${source}: ${facts.runUrl}`,
    };
  return {
    kind: "open",
    issueTitle: `main is red at ${short} after ${facts.pr ? `#${facts.pr.number}` : "a direct commit"}`,
    issueBody: [
      `@${facts.owner} CI failed on main at ${facts.sha}, the merge of ${source}.`,
      "",
      `Failed run: ${facts.runUrl}`,
      "",
      "1. If the failure is a known flaky test, rerun the failed jobs. When main is green again, close this issue and the revert PR.",
      "2. Otherwise merge the revert PR (its CI was dispatched) or land a fix, then close this issue.",
      "",
      "Releases are cut only from a main commit whose push CI is green (docs/release.md).",
    ].join("\n"),
    revertBranch: `revert/main-${short}`,
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
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await child.exited) === 0;
}

async function run() {
  const repo = Bun.env.GITHUB_REPOSITORY!;
  const sha = Bun.env.HEAD_SHA!;
  const pulls = JSON.parse(
    await gh(["api", `repos/${repo}/commits/${sha}/pulls`]),
  ) as Array<{ number: number; title: string; merge_commit_sha?: string }>;
  const pr = pulls.find((pull) => pull.merge_commit_sha === sha) ?? pulls[0];
  const open = JSON.parse(
    await gh([
      "issue",
      "list",
      "--label",
      MAIN_RED_LABEL,
      "--state",
      "open",
      "--json",
      "number",
    ]),
  ) as Array<{ number: number }>;
  const plan = planMainGate({
    sha,
    runUrl: Bun.env.RUN_URL!,
    owner: Bun.env.GITHUB_REPOSITORY_OWNER!,
    pr: pr && { number: pr.number, title: pr.title },
    openIssue: open[0]?.number,
  });
  if (plan.kind === "comment") {
    await gh(
      ["issue", "comment", String(plan.issue), "--body-file", "-"],
      plan.body,
    );
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
  const issue = Number(issueUrl.split("/").pop());
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
