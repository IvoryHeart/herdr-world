import { expect, test } from "bun:test";
import {
  onlyInfraFlakes,
  planMainGate,
  redShaMarker,
  redShaOf,
  readJobLog,
} from "./main-gate";

const sha = "0123456789abcdef0123456789abcdef01234567";
const runUrl = "https://github.com/example/repo/actions/runs/1";
const base = {
  sha,
  runUrl,
  owner: "example-owner",
  revertBranchExists: false,
} as const;

test("failed-job logs reach classification without terminal-output filtering", async () => {
  const log =
    "\u001b[31merror: browser startup timed out after 35000ms\u001b[0m";
  const request = async (url: string, options: RequestInit) => {
    expect(String(url)).toBe(
      "https://api.github.com/repos/example/repo/actions/jobs/42/logs",
    );
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer synthetic-token",
    });
    return new Response(log);
  };
  expect(await readJobLog("example/repo", 42, "synthetic-token", request)).toBe(
    log,
  );
  expect(
    onlyInfraFlakes([
      {
        name: "World browser tests",
        log: [
          "##[group]Run tests",
          log,
          "##[error]Process completed with exit code 1",
        ].join("\n"),
      },
    ]),
  ).toBe(true);
  const denied = async () => new Response("unavailable", { status: 403 });
  await expect(
    readJobLog("example/repo", 42, "synthetic-token", denied),
  ).rejects.toThrow("403");
});

test("the first red main commit opens an issue naming its PR and prepares a revert", () => {
  const plan = planMainGate({
    ...base,
    conclusion: "failure",
    pr: { number: 42, title: "Add a widget" },
  });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.reopen).toBeUndefined();
  expect(plan.issueTitle).toBe("main is red at 01234567 after #42");
  expect(plan.issueBody).toContain("@example-owner");
  expect(plan.issueBody).toContain(`${sha}, the merge of #42 (Add a widget)`);
  expect(plan.issueBody).toContain(runUrl);
  expect(redShaOf(plan.issueBody)).toBe(sha);
  expect(plan.createRevert).toBe(true);
  expect(plan.revertBranch).toBe("revert/main-01234567");
  expect(plan.revertTitle).toBe(
    "Revert #42 (Add a widget) (main red at 01234567)",
  );
  const body = plan.revertBody(7);
  expect(body).toContain("#7");
  expect(body).toContain("Changelog: none");
});

test("a commit without a merged PR is named by its hash", () => {
  const plan = planMainGate({ ...base, conclusion: "failure" });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.issueTitle).toBe("main is red at 01234567 after a direct commit");
  expect(plan.revertTitle).toBe(
    "Revert commit 01234567 (main red at 01234567)",
  );
});

test("while a main-red issue is open, later red commits only comment on it", () => {
  expect(
    planMainGate({
      ...base,
      conclusion: "failure",
      pr: { number: 43, title: "Follow-up" },
      openIssue: { number: 7, atOrAfterRed: true },
    }),
  ).toEqual({
    kind: "comment",
    issue: 7,
    body: `main is still red at ${sha}, after #43 (Follow-up): ${runUrl}`,
  });
});

test("a green run at or after the red commit closes the issue and its revert", () => {
  const red = "fedcba9876543210fedcba9876543210fedcba98";
  expect(
    planMainGate({
      ...base,
      conclusion: "success",
      openIssue: { number: 7, redSha: red, atOrAfterRed: true },
    }),
  ).toMatchObject({
    kind: "resolve",
    issue: 7,
    // The red commit's revert, not one named after the green commit.
    revertBranch: "revert/main-fedcba98",
  });
  // A late green run of an older commit leaves a newer break open.
  expect(
    planMainGate({
      ...base,
      conclusion: "success",
      openIssue: { number: 7, atOrAfterRed: false },
    }),
  ).toEqual({ kind: "none" });
  expect(planMainGate({ ...base, conclusion: "success" })).toEqual({
    kind: "none",
  });
});

test("the same commit failing again after its issue closed reuses the issue and the revert branch", () => {
  const plan = planMainGate({
    ...base,
    conclusion: "failure",
    closedIssueForSha: 7,
    revertBranchExists: true,
  });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.reopen).toBe(7);
  expect(plan.createRevert).toBe(false);
});

test("the red commit marker round-trips and ignores other text", () => {
  expect(redShaOf(`text\n${redShaMarker(sha)}\n`)).toBe(sha);
  expect(redShaOf("<!-- main-gate-sha: not-a-sha -->")).toBeUndefined();
});

test("a red tip of an untested batch names every merge and prepares no revert", () => {
  const earlier = "1111111111111111111111111111111111111111";
  const direct = "2222222222222222222222222222222222222222";
  const plan = planMainGate({
    ...base,
    conclusion: "failure",
    pr: { number: 44, title: "Newest" },
    untested: [
      { sha: earlier, pr: { number: 42, title: "Older" } },
      { sha: direct },
    ],
  });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.issueTitle).toBe("main is red at 01234567 after 3 merges");
  expect(plan.issueBody).toContain("- #42 (Older) at 11111111");
  expect(plan.issueBody).toContain("- commit 22222222 at 22222222");
  expect(plan.issueBody).toContain("- #44 (Newest) at 01234567 (tested)");
  expect(plan.issueBody).toContain("No revert was prepared");
  expect(plan.createRevert).toBe(false);
  expect(redShaOf(plan.issueBody)).toBe(sha);
});

const stamp = (line: string) => `2026-10-23T07:44:33.6070043Z ${line}`;
/** A job log: an earlier passing step, then the failing step. */
const jobLog = (...failing: string[]) =>
  [
    "##[group]Run bun install --frozen-lockfile",
    "error: earlier step diagnostics mention an error but passed",
    "##[endgroup]",
    "##[group]Run bun run test:world --shard=3/6",
    ...failing,
    "##[error]Process completed with exit code 1.",
  ]
    .map(stamp)
    .join("\n");
const startupLines = [
  "37 |           () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),",
  "error: Hosts filter browser acceptance browser startup timed out after 35000ms",
  "      at <anonymous> (web/src/browserChrome.ts:37:28)",
  "(fail) the shell preserves targets [35199ms]",
  "(pass) the shell preserves other targets [1364ms]",
  "1 tests failed:",
  "(fail) the shell preserves targets [35199ms]",
  "25 pass",
  "1 fail",
  'error: script "test:world" exited with code 1',
];

test("only known infrastructure flakes are rerun before alerting", () => {
  const startup = {
    name: "World browser tests (3/6)",
    log: jobLog(...startupLines),
  };
  const delivery = { name: "Delivery checks", log: "Delivery checks failed" };
  expect(onlyInfraFlakes([startup, delivery])).toBe(true);
  expect(
    onlyInfraFlakes([
      {
        name: "Behavioral verification",
        log: jobLog(
          "AssertionError: Invalid control group (ActiveState=inactive)",
          'error: script "verification:resources" exited with code 1',
        ),
      },
    ]),
  ).toBe(true);
  // A real failure next to a flake, in another job or in the same step.
  expect(
    onlyInfraFlakes([
      startup,
      {
        name: "Repository validation",
        log: jobLog("web asset total: 13.3/13.25 MiB (budget exceeded)"),
      },
    ]),
  ).toBe(false);
  expect(
    onlyInfraFlakes([
      {
        name: startup.name,
        log: jobLog(
          ...startupLines,
          "web asset total: 13.3/13.25 MiB (budget exceeded)",
        ),
      },
    ]),
  ).toBe(false);
  expect(
    onlyInfraFlakes([
      {
        name: startup.name,
        log: jobLog(
          ...startupLines,
          "error: expect(received).toEqual(expected)",
        ),
      },
    ]),
  ).toBe(false);
  // Two failing tests are not one flake.
  expect(
    onlyInfraFlakes([
      {
        name: startup.name,
        log: jobLog(...startupLines, "(fail) the Office town renders [1732ms]"),
      },
    ]),
  ).toBe(false);
  // A flake string only in an earlier, passing step does not count.
  expect(
    onlyInfraFlakes([
      {
        name: startup.name,
        log: [
          "##[group]Run warm",
          "error: browser startup timed out after 35000ms",
          "##[group]Run test",
          "error: expect(received).toEqual(expected)",
          "##[error]Process completed with exit code 1.",
        ]
          .map(stamp)
          .join("\n"),
      },
    ]),
  ).toBe(false);
  // A later always() step that also failed (an evidence upload) is not the flake.
  expect(
    onlyInfraFlakes([
      {
        name: "Behavioral verification",
        log: [
          "##[group]Run bun run verification:resources --system",
          "AssertionError: Invalid control group (ActiveState=inactive)",
          "##[error]Process completed with exit code 1.",
          "##[group]Run actions/upload-artifact",
          "Error: No files were found with the provided path",
          "##[error]Process completed with exit code 1.",
        ]
          .map(stamp)
          .join("\n"),
      },
    ]),
  ).toBe(false);
  // An annotation with an unfamiliar message is a failure even without "error".
  expect(
    onlyInfraFlakes([
      {
        name: "Behavioral verification",
        log: jobLog(
          "AssertionError: Invalid control group (ActiveState=inactive)",
          "##[error]ENOENT",
        ),
      },
    ]),
  ).toBe(false);
  // The Windows staging lock is a product bug (#254), not a runner flake.
  expect(
    onlyInfraFlakes([
      {
        name: "Installer upgrade (windows-arm64)",
        log: jobLog(
          "Remove-Item : Cannot remove item C:\\Temp\\server\\.plugin-install-x\\herdr-world.exe: The process cannot access the file",
        ),
      },
    ]),
  ).toBe(false);
  // A failed job whose log shows no failed step proves nothing.
  expect(
    onlyInfraFlakes([
      { name: startup.name, log: "browser startup timed out after 35000ms" },
    ]),
  ).toBe(false);
  // Only the aggregate failed: nothing to attribute to a flake.
  expect(onlyInfraFlakes([delivery])).toBe(false);
});

test("a batch's alert explains the missing revert without claiming one exists", () => {
  const plan = planMainGate({
    ...base,
    conclusion: "failure",
    untested: [{ sha: "1111111111111111111111111111111111111111" }],
  });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.createRevert).toBe(false);
  expect(plan.revertSkipped).toBe("batch");
  const existing = planMainGate({
    ...base,
    conclusion: "failure",
    revertBranchExists: true,
  });
  if (existing.kind !== "open") throw new Error("expected an issue");
  expect(existing.revertSkipped).toBe("exists");
});

test("a range longer than the list counts the merges it leaves out", () => {
  const listed = Array.from({ length: 20 }, (_, index) => ({
    sha: String(index).padStart(40, "a"),
  }));
  const plan = planMainGate({
    ...base,
    conclusion: "failure",
    untested: listed,
    omitted: 4,
  });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.issueTitle).toBe("main is red at 01234567 after 25 merges");
  expect(plan.issueBody).toContain("newest of 25 merges");
  expect(plan.issueBody).toContain(
    "- 4 older merges since the last green commit, not listed",
  );
});
