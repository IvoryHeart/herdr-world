import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, input, NOW, SHA } from "./gate/cases";
import { finding, reviewPost } from "./crew-round-fixture";
import type { Deps } from "./crew/deps";
import { evaluatorPrompt, processPrompt } from "./crew/evaluator";
import {
  authoredDelta,
  openFindings,
  withReplies,
  type CrewPost,
} from "./crew/review-facts";
import type { Evaluation } from "./crew/round-policy-store";
import { reviewerPrompt } from "./crew/worker";

test("finding replies require one explicit signed response per finding", () => {
  const gateInput = input({
    head: SHA.fixed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "0/0 resolved, 2 new" },
    ],
  });
  const posts = [
    {
      ...reviewPost,
      body: reviewPost.body + "\nP2 src/widget.ts:20 incorrect owner",
    },
  ];
  const findings = openFindings(gateInput, posts);
  expect(findings.map((entry) => entry.id)).toEqual([
    "rev2:101:1",
    "rev2:101:2",
  ]);
  const replied = withReplies(
    findings,
    [
      {
        id: "102",
        body: "[builder]\nsrc/widget.ts:10 fixed",
        at: NOW,
        url: "reply",
      },
    ],
    "builder",
    7,
  );
  expect(replied.map((entry) => Boolean(entry.reply))).toEqual([true, false]);
});

test("reply identifiers and line numbers must match whole tokens", () => {
  const findings = [finding, { ...finding, id: "rev2:101:10", line: 100 }];
  const post = {
    id: "102",
    body: "[builder]\nsrc/widget.ts:100 fixed\nrev2:101:10 fixed",
    at: NOW,
    url: "reply",
  };
  expect(
    withReplies(findings, [post], "builder", 7).map((entry) =>
      Boolean(entry.reply),
    ),
  ).toEqual([false, true]);
});

test("extensionless paths and signed inline replies remain actionable", () => {
  const gateInput = input({
    head: SHA.fixed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "0/0 resolved, 3 new" },
    ],
  });
  const post = {
    ...reviewPost,
    body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 3 new\nP2 .githooks/pre-push:10 broken guard\nP2 Dockerfile:20 broken build\nP2 scripts/ci-helper:30 broken runner`,
  };
  const findings = openFindings(gateInput, [post]);
  expect(findings.map((entry) => entry.file)).toEqual([
    ".githooks/pre-push",
    "Dockerfile",
    "scripts/ci-helper",
  ]);
  expect(
    withReplies(
      findings,
      [
        {
          id: "102",
          body: "[builder]\n.githooks/pre-push:10 fixed\nDockerfile:20 fixed\nscripts/ci-helper:30 fixed",
          at: NOW,
          url: "reply",
        },
      ],
      "builder",
      7,
    ).every((entry) => entry.reply),
  ).toBe(true);
  const inline: CrewPost = {
    id: "103",
    reviewId: "101",
    body: "P2 incorrect recovery",
    path: "src/widget.ts",
    line: 10,
    at: NOW - 60_000,
    url: "inline",
  };
  const aggregate = {
    ...reviewPost,
    body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 1 new`,
  };
  const inlineFindings = openFindings(gateInput, [aggregate, inline]);
  expect(inlineFindings).toHaveLength(1);
  expect(
    withReplies(
      inlineFindings,
      [
        {
          id: "104",
          replyTo: "103",
          body: "[builder] fixed",
          at: NOW,
          url: "inline-reply",
        },
      ],
      "builder",
      7,
    )[0]!.reply,
  ).toBe("inline-reply");
});

test("review prompts enforce scoped round 2, issue scope and evaluator decisions", () => {
  const task = {
    repo: config.repo,
    pr: 7,
    head: SHA.fixed,
    reviewer: "rev2",
    title: "Recovery",
    url: "https://github.com/example-org/widgets/pull/7",
    branch: "agent/builder-7",
    author: "builder",
  };
  expect(reviewerPrompt(task)).toContain("scope drift");
  const prompt = reviewerPrompt({
    ...task,
    since: SHA.reviewed,
    scope: [finding.id],
  });
  expect(prompt).toContain("--remerge-diff");
  expect(prompt).toContain("ONLY these findings");
  const evaluation: Evaluation = {
    pr: 7,
    checkpoint: 2,
    head: SHA.fixed,
    round: 2,
    findings: [finding],
    status: "evaluating",
    seat: "splitter",
    process: "splitter",
  };
  expect(evaluatorPrompt(config.repo, evaluation, ["splitter"])).toContain(
    "EVERY round",
  );
  expect(processPrompt(config.repo, evaluation)).toContain("PROCESS #7: done");
});

test("real git delta excludes main imports and retains manual merge resolutions", () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-delta-"));
  const run: Deps["run"] = (argv) => {
    const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  const git = (...args: string[]) => {
    const result = run(["git", "-C", dir, ...args]);
    expect(result.code).toBe(0);
    return result.stdout.trim();
  };
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Synthetic Author");
    git("config", "user.email", "author@example.invalid");
    writeFileSync(join(dir, "widget.ts"), "initial\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    git("checkout", "-qb", "feature");
    writeFileSync(join(dir, "feature.ts"), "feature\n");
    git("add", ".");
    git("commit", "-qm", "reviewed");
    const reviewed = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    writeFileSync(join(dir, "import.ts"), "main\n");
    git("add", ".");
    git("commit", "-qm", "main import");
    git("checkout", "-q", "feature");
    git("merge", "--no-edit", "main");
    const merged = git("rev-parse", "HEAD");
    expect(
      authoredDelta(run, join(dir, ".git"), reviewed, merged),
    ).toMatchObject({ files: [], onlyMain: true });
    writeFileSync(join(dir, "widget.ts"), "author fix\n");
    git("add", ".");
    git("commit", "-qm", "fix");
    const fixed = git("rev-parse", "HEAD");
    expect(
      authoredDelta(run, join(dir, ".git"), reviewed, fixed),
    ).toMatchObject({ files: ["widget.ts"], onlyMain: false });
    git("mv", "feature.ts", "renamed.ts");
    git("commit", "-qm", "rename finding file");
    expect(
      authoredDelta(run, join(dir, ".git"), fixed, git("rev-parse", "HEAD"))
        .files,
    ).toEqual(["feature.ts", "renamed.ts"]);
    const beforeConflict = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    writeFileSync(join(dir, "widget.ts"), "main edit\n");
    git("add", ".");
    git("commit", "-qm", "main changes same file");
    git("checkout", "-q", "feature");
    expect(run(["git", "-C", dir, "merge", "--no-edit", "main"]).code).toBe(1);
    writeFileSync(join(dir, "widget.ts"), "manual resolution\n");
    git("add", ".");
    git("commit", "-qm", "resolve");
    expect(
      authoredDelta(
        run,
        join(dir, ".git"),
        beforeConflict,
        git("rev-parse", "HEAD"),
      ),
    ).toMatchObject({ files: ["widget.ts"], onlyMain: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
