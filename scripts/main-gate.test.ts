import { expect, test } from "bun:test";
import { planMainGate, redShaMarker, redShaOf } from "./main-gate";

const sha = "0123456789abcdef0123456789abcdef01234567";
const runUrl = "https://github.com/example/repo/actions/runs/1";
const base = {
  sha,
  runUrl,
  owner: "example-owner",
  revertBranchExists: false,
} as const;

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
