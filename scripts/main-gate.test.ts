import { expect, test } from "bun:test";
import { planMainGate } from "./main-gate";

const sha = "0123456789abcdef0123456789abcdef01234567";
const runUrl = "https://github.com/example/repo/actions/runs/1";

test("the first red main commit opens an issue naming its PR and prepares a revert", () => {
  const plan = planMainGate({
    sha,
    runUrl,
    owner: "example-owner",
    pr: { number: 42, title: "Add a widget" },
  });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.issueTitle).toBe("main is red at 01234567 after #42");
  expect(plan.issueBody).toContain("@example-owner");
  expect(plan.issueBody).toContain(`${sha}, the merge of #42 (Add a widget)`);
  expect(plan.issueBody).toContain(runUrl);
  expect(plan.revertBranch).toBe("revert/main-01234567");
  expect(plan.revertTitle).toBe(
    "Revert #42 (Add a widget) (main red at 01234567)",
  );
  const body = plan.revertBody(7);
  expect(body).toContain("#7");
  expect(body).toContain("Changelog: none");
});

test("a direct commit is named by its hash", () => {
  const plan = planMainGate({ sha, runUrl, owner: "example-owner" });
  if (plan.kind !== "open") throw new Error("expected an issue");
  expect(plan.issueTitle).toBe("main is red at 01234567 after a direct commit");
  expect(plan.revertTitle).toBe(
    "Revert commit 01234567 (main red at 01234567)",
  );
});

test("while a main-red issue is open, later red commits only comment on it", () => {
  expect(
    planMainGate({
      sha,
      runUrl,
      owner: "example-owner",
      pr: { number: 43, title: "Follow-up" },
      openIssue: 7,
    }),
  ).toEqual({
    kind: "comment",
    issue: 7,
    body: `main is still red at ${sha}, after #43 (Follow-up): ${runUrl}`,
  });
});
