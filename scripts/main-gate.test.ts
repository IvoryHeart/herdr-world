import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  infrastructureOnly,
  infraSteps,
  planMainGate,
  redShaMarker,
  redShaOf,
} from "./main-gate";

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

type Job = {
  name: string;
  conclusion: string;
  steps?: Array<{ name: string; conclusion: string }>;
};

const delivery: Job = {
  name: "Delivery checks",
  conclusion: "failure",
  steps: [{ name: "Run full repository check", conclusion: "failure" }],
};

test("infrastructure step names follow uses declarations, not labels or action inputs", () => {
  const actions = [
    "actions/checkout",
    "actions/cache",
    "actions/setup-node",
    "oven-sh/setup-bun",
    "actions/upload-artifact",
    "actions/download-artifact",
  ];
  const names = infraSteps([
    actions
      .map((action) => `      - uses: ${action}@revision # pinned`)
      .join("\n"),
    `steps:
  - name: 'Retain compact evidence'
    uses: actions/upload-artifact@revision
    with:
      name: artifact-input
  - name: Setup shell tests
    run: bun test
  - uses: example/setup-bun@revision
  - uses: actions/download-artifact@revision
    name: "Fetch results"
`,
  ]);
  for (const action of actions) {
    expect(names.has(`Run ${action}@revision`)).toBe(true);
    expect(names.has(`Post Run ${action}@revision`)).toBe(true);
  }
  expect(names.has("Retain compact evidence")).toBe(true);
  expect(names.has("Post Retain compact evidence")).toBe(true);
  expect(names.has("Fetch results")).toBe(true);
  expect(names.has("artifact-input")).toBe(false);
  expect(names.has("Setup shell tests")).toBe(false);
  expect(names.has("Run example/setup-bun@revision")).toBe(false);
});

test.each([
  { name: "no jobs", jobs: [] },
  { name: "only a delivery aggregate", jobs: [delivery] },
  {
    name: "failed job without step evidence",
    jobs: [{ name: "Units", conclusion: "failure" }],
  },
  {
    name: "cancelled job with a failed test",
    jobs: [
      {
        name: "Units",
        conclusion: "cancelled",
        steps: [{ name: "Run tests", conclusion: "failure" }],
      },
    ],
  },
  {
    name: "mixed infrastructure and test jobs",
    jobs: [
      { name: "Runner", conclusion: "cancelled" },
      {
        name: "Units",
        conclusion: "failure",
        steps: [{ name: "Run tests", conclusion: "failure" }],
      },
    ],
  },
])("$name is insufficient evidence for an infrastructure rerun", ({ jobs }) => {
  expect(infrastructureOnly(jobs, infraSteps([]))).toBe(false);
});

/** Run the real CLI against synthetic GitHub/git executables; never contact GitHub. */
async function syntheticGate({
  jobs,
  attempt = 1,
  conclusion = "failure",
  queryFails = false,
}: {
  jobs: Job[];
  attempt?: number;
  conclusion?: string;
  queryFails?: boolean;
}) {
  const directory = mkdtempSync(join(tmpdir(), "world-main-gate-"));
  try {
    mkdirSync(join(directory, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(directory, ".github", "workflows", "ci.yml"),
      `jobs:
  test:
    steps:
      - name: "Prepare toolchain"
        uses: oven-sh/setup-bun@revision # pinned action
      - uses: actions/checkout@revision
      - name: Retain evidence
        uses: actions/upload-artifact@revision
        with:
          name: evidence-input-name
      - name: Run tests
        run: bun test
`,
    );
    writeFileSync(
      join(directory, "facts.json"),
      JSON.stringify({ jobs, conclusion, sha, queryFails }),
    );
    const callsFile = join(directory, "calls.jsonl");
    for (const tool of ["gh", "git"]) {
      const file = join(directory, tool);
      writeFileSync(
        file,
        `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.GATE_CALLS, JSON.stringify({ tool: ${JSON.stringify(tool)}, args }) + "\\n");
const facts = JSON.parse(readFileSync("facts.json", "utf8"));
if (${JSON.stringify(tool)} === "gh") {
  if (args[0] === "api") {
    if (args[1].includes("/jobs?")) {
      if (facts.queryFails) process.exit(2);
      // Put the substantive failure on page two, after the aggregate.
      console.log(JSON.stringify([{ jobs: facts.jobs.slice(0, 1) }, { jobs: facts.jobs.slice(1) }]));
    } else if (args[1].endsWith("/pulls")) console.log("[]");
    else if (!args[1].includes("/actions/workflows/ci.yml/runs?")) process.exit(2);
  } else if (args[0] === "issue" && args[1] === "list") {
    console.log(JSON.stringify(facts.conclusion === "success" ? [{
      number: 7, state: "OPEN", body: "<!-- main-gate-sha: " + facts.sha + " -->"
    }] : []));
  } else if (args[0] === "issue" && args[1] === "create") {
    console.log("https://github.com/example/repo/issues/7");
  } else if (args[0] === "pr" && args[1] === "list") {
    console.log(JSON.stringify([{ number: 8, headRefName: "revert/main-" + facts.sha.slice(0, 8) }]));
  } else if (!["label", "issue", "pr", "run"].includes(args[0])) process.exit(2);
}
`,
      );
      chmodSync(file, 0o755);
    }
    const child = Bun.spawn(
      [process.execPath, new URL("./main-gate.ts", import.meta.url).pathname],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GATE_CALLS: callsFile,
          GITHUB_REPOSITORY: "example/repo",
          GITHUB_REPOSITORY_OWNER: base.owner,
          HEAD_SHA: sha,
          CONCLUSION: conclusion,
          RUN_URL: runUrl,
          RUN_ID: "1",
          RUN_ATTEMPT: String(attempt),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (queryFails) {
      expect(code).toBe(0);
      expect(stderr).toContain(
        "Could not classify CI failure; alerting as usual",
      );
    } else expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const calls = readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { tool: string; args: string[] });
    return { stdout, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a runner-less cancelled job reruns once without an issue or revert PR", async () => {
  const { stdout, calls } = await syntheticGate({
    jobs: [delivery, { name: "macOS lifecycle", conclusion: "cancelled" }],
  });
  expect(stdout).toContain("rerunning once");
  expect(calls).toContainEqual({
    tool: "gh",
    args: ["run", "rerun", "1", "--failed"],
  });
  expect(calls.some(({ args }) => ["issue", "pr"].includes(args[0]))).toBe(
    false,
  );
  console.info(stdout.trim());
});

test("a failed setup action reruns once, using its workflow step name", async () => {
  const { stdout, calls } = await syntheticGate({
    jobs: [
      delivery,
      {
        name: "Unit tests",
        conclusion: "failure",
        steps: [{ name: "Prepare toolchain", conclusion: "failure" }],
      },
    ],
  });
  expect(stdout).toContain("rerunning once");
  expect(calls.at(-1)?.args).toEqual(["run", "rerun", "1", "--failed"]);
  expect(calls.some(({ args }) => ["issue", "pr"].includes(args[0]))).toBe(
    false,
  );
});

test("a failed test step alerts even when an artifact upload also fails", async () => {
  const { stdout, calls } = await syntheticGate({
    jobs: [
      delivery,
      {
        name: "Unit tests",
        conclusion: "failure",
        steps: [
          { name: "Run tests", conclusion: "failure" },
          { name: "Retain evidence", conclusion: "failure" },
        ],
      },
    ],
  });
  expect(stdout).not.toContain("rerunning once");
  expect(calls.some(({ args }) => args[0] === "run")).toBe(false);
  expect(
    calls.some(({ args }) => args.join(" ").startsWith("issue create")),
  ).toBe(true);
});

test("attempt two alerts even when the failure is infrastructure only", async () => {
  const { calls } = await syntheticGate({
    attempt: 2,
    jobs: [delivery, { name: "macOS lifecycle", conclusion: "cancelled" }],
  });
  expect(calls.some(({ args }) => args[0] === "run")).toBe(false);
  expect(
    calls.some(({ args }) => args.join(" ").startsWith("issue create")),
  ).toBe(true);
});

test("unavailable job evidence preserves the alert instead of guessing infrastructure", async () => {
  const { calls } = await syntheticGate({ jobs: [], queryFails: true });
  expect(calls.some(({ args }) => args[0] === "run")).toBe(false);
  expect(
    calls.some(({ args }) => args.join(" ").startsWith("issue create")),
  ).toBe(true);
});

test("a green rerun resolves the existing issue and revert PR", async () => {
  const { calls } = await syntheticGate({
    attempt: 2,
    conclusion: "success",
    jobs: [],
  });
  expect(calls.some(({ args }) => args[0] === "run")).toBe(false);
  expect(
    calls.some(({ args }) => args.slice(0, 3).join(" ") === "issue close 7"),
  ).toBe(true);
  expect(
    calls.some(({ args }) => args.slice(0, 3).join(" ") === "pr close 8"),
  ).toBe(true);
});
