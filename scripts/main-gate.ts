/** Keep one red-main issue, retry infrastructure once, never create reverts. */
import { retryInfrastructure } from "./pipeline-retry";

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
  /** Earlier merges since the last green main commit, oldest first; CI skipped them. */
  untested?: Array<{ sha: string; pr?: { number: number; title: string } }>;
  /** Older merges in that range left out of `untested` to keep the list short. */
  omitted?: number;
};

export type MainGatePlan =
  | { kind: "none" }
  | { kind: "comment"; issue: number; body: string }
  | { kind: "resolve"; issue: number; body: string }
  | {
      kind: "open";
      reopen?: number;
      issueTitle: string;
      issueBody: string;
    };

export function planMainGate(facts: MainGateFacts): MainGatePlan {
  const short = facts.sha.slice(0, 8);
  const source = facts.pr
    ? `#${facts.pr.number} (${facts.pr.title})`
    : `commit ${short}`;
  if (facts.conclusion === "success")
    return facts.openIssue?.atOrAfterRed && facts.openIssue.redSha
      ? {
          kind: "resolve",
          issue: facts.openIssue.number,
          body: `main is green again at ${facts.sha}: ${facts.runUrl}. Closing this issue.`,
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
      "Infrastructure failures retry once automatically; this issue stays open until main is green. Fix the failing code or choose a revert manually. No automatic revert PR is created.",
      "",
      "Releases are cut only from a main commit whose push CI is green (docs/release.md).",
      "",
      redShaMarker(facts.sha),
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
  });
  const retry = () =>
    retryInfrastructure(
      repo,
      Bun.env.SOURCE_RUN!,
      Number(Bun.env.SOURCE_ATTEMPT),
    );
  if (plan.kind === "none") return;
  if (plan.kind === "comment") {
    await gh(
      ["issue", "comment", String(plan.issue), "--body-file", "-"],
      plan.body,
    );
    await retry();
    return;
  }
  if (plan.kind === "resolve") {
    await gh(["issue", "close", String(plan.issue), "--comment", plan.body]);

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
  if (plan.reopen !== undefined) {
    const issue = plan.reopen;
    await gh(["issue", "reopen", String(issue)]);
    await gh(
      ["issue", "comment", String(issue), "--body-file", "-"],
      `CI failed again on main at ${sha}: ${Bun.env.RUN_URL}`,
    );
  } else {
    await gh(
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
  }

  await retry();
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
