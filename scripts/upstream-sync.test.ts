import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscriptionEnvironment } from "./upstream-local";
import {
  checkPull,
  parseSync,
  recordedSource,
  reconstructMerge,
  requiresHumanReview,
  shouldRepair,
  validateSync,
  validateVerdict,
  validatePublishPaths,
  validateSubmittedHead,
  parseApiResponse,
  validatePublication,
  validateIntegrationReport,
} from "./upstream-sync";

const base = "a".repeat(40);
const target = "b".repeat(40);
const head = "c".repeat(40);
const sync = { base, target, tag: "v1.2.3", repair: 0 };

test("source metadata accepts exact stable targets and rejects moving or injected refs", () => {
  expect(
    parseSync(`Description\n<!-- upstream-sync ${JSON.stringify(sync)} -->`),
  ).toEqual(sync);
  expect(recordedSource(`- Roamgate source: v1.2.3, \`${base}\`\n`)).toBe(base);
  for (const change of [
    { target: "main" },
    { base: "--help" },
    { tag: "v1.2.3\nkey=value" },
    { tag: "v1.2.3-rc.1" },
    { repair: 2 },
    { head: "refs/heads/main" },
    { pr: -1 },
  ])
    expect(() => validateSync({ ...sync, ...change })).toThrow();
  expect(() => parseSync("No metadata")).toThrow();
  expect(() => recordedSource("No source record")).toThrow();
});

test("bounded repair requires current-head findings or a completed failing CI run", () => {
  // Exhaust the allowed/forbidden combinations rather than model a second state machine.
  for (const repair of [0, 1]) {
    for (const reviewState of ["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]) {
      for (const currentReview of [false, true]) {
        for (const status of ["queued", "in_progress", "completed"]) {
          for (const conclusion of ["success", "failure", "cancelled"]) {
            for (const currentCI of [false, true]) {
              expect(
                shouldRepair(
                  { ...sync, repair },
                  head,
                  [
                    {
                      state: reviewState,
                      commit_id: currentReview ? head : base,
                    },
                  ],
                  { head_sha: currentCI ? head : base, status, conclusion },
                ),
              ).toBe(
                repair === 0 &&
                  ((reviewState === "CHANGES_REQUESTED" && currentReview) ||
                    (currentCI &&
                      status === "completed" &&
                      conclusion === "failure")),
              );
            }
          }
        }
      }
    }
  }
  expect(shouldRepair(sync, head, [])).toBe(false);
  expect(
    shouldRepair(sync, head, [
      {
        state: "CHANGES_REQUESTED",
        commit_id: head,
        user: { login: "reviewer" },
      },
      { state: "APPROVED", commit_id: head, user: { login: "reviewer" } },
    ]),
  ).toBe(false);
});

test("approval authority is restricted to the open bot PR and captured head", () => {
  const repo = "example/world";
  const pr = {
    number: 1,
    body: "",
    state: "open",
    draft: false,
    user: { login: "github-actions[bot]" },
    head: { ref: "upstream/roamgate", sha: head, repo: { full_name: repo } },
    base: { ref: "main", sha: base, repo: { full_name: repo } },
  };
  expect(() => checkPull(pr, { ...sync, head }, repo)).not.toThrow();
  for (const change of [
    { state: "closed" },
    { draft: true },
    { user: { login: "another-bot" } },
    { head: { ...pr.head, sha: target } },
    { head: { ...pr.head, repo: { full_name: "example/fork" } } },
    { head: { ...pr.head, ref: "another-branch" } },
    { base: { ...pr.base, ref: "another-base" } },
  ])
    expect(() =>
      checkPull({ ...pr, ...change }, { ...sync, head }, repo),
    ).toThrow();
});

test("control changes require human approval even when the agent approves", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".agents/skills/reviewer/SKILL.md",
    ".githooks/pre-push",
    "verification/coverage.json",
    "quint/control.qnt",
    "tools/quint/execution.json",
    "openspec/specs/access/spec.md",
    "AGENTS.md",
    "server/AGENTS.md",
    "CONTRIBUTING.md",
    "scripts/upstream-sync.ts",
    "package.json",
    "web/package.json",
    ".oxlintrc.json",
    "tsconfig.json",
    "web/tsconfig.json",
    "bunfig.toml",
    "biome.json",
    "web/vite.config.ts",
    "bun.lock",
    ".gitignore",
  ])
    expect(requiresHumanReview(["web/src/App.tsx", path])).toBe(true);
  expect(
    requiresHumanReview(["web/src/App.tsx", "UPSTREAM.md", "CHANGELOG.md"]),
  ).toBe(false);
});

test("candidate workflow and Codex configuration cannot execute before human integration", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/actions/check/action.yml",
    ".github",
    ".codex/config.toml",
    ".codex",
  ]) {
    expect(() => validatePublishPaths(["web/src/App.tsx", path])).toThrow(
      "manual integration",
    );
  }
  expect(() =>
    validatePublishPaths(["web/src/App.tsx", "UPSTREAM.md"]),
  ).not.toThrow();
});

test("malformed, empty and oversized reviews cannot grant approval", () => {
  expect(
    validateVerdict({
      decision: "approve",
      summary: "Reviewed the adapted terminal behavior and consumer tests.",
    }).decision,
  ).toBe("approve");
  for (const value of [
    null,
    {},
    { decision: "APPROVE", summary: "A sufficiently long explanation." },
    { decision: "approve", summary: "" },
    { decision: "approve", summary: "x".repeat(30001) },
  ]) {
    expect(() => validateVerdict(value)).toThrow();
  }
});

test("local subscription jobs remove API overrides and reject stale or missing review heads", () => {
  const original = {
    OPENAI_API_KEY: "synthetic",
    CODEX_API_KEY: "synthetic",
    CODEX_ACCESS_TOKEN: "synthetic",
    CODEX_HOME: "/example/codex",
    PATH: "/example/bin",
  };
  const filtered = subscriptionEnvironment(original);
  expect(filtered).toEqual({
    CODEX_HOME: "/example/codex",
    PATH: "/example/bin",
  });
  expect(original.OPENAI_API_KEY).toBe("synthetic");
  expect(() => validateSubmittedHead(head, head)).not.toThrow();
  for (const stale of [undefined, "", base, "main"])
    expect(() => validateSubmittedHead(stale, head)).toThrow();
});

test("successful no-content dispatch responses do not become false failures", () => {
  expect(parseApiResponse("")).toBeUndefined();
  expect(parseApiResponse("\n")).toBeUndefined();
  expect(parseApiResponse('{"id":123}')).toEqual({ id: 123 });
  expect(() => parseApiResponse("invalid")).toThrow();
});

test("report bounds preserve evidence without accepting control bytes or silent truncation", () => {
  const evidence = "Q41 checks passed; unresolved platform decision remains.\n";
  expect(validateIntegrationReport(evidence)).toBe(evidence);
  for (const invalid of [
    undefined,
    "",
    "x".repeat(12001),
    "é".repeat(6001),
    evidence + "\u0000",
  ]) {
    expect(() => validateIntegrationReport(invalid)).toThrow();
  }
});

test("publication retries are idempotent while target drift and extra repair revisions fail", () => {
  const published = { ...sync, head };
  expect(() => validatePublication(published, published)).not.toThrow();
  expect(() =>
    validatePublication(published, { ...published, repair: 1, head: target }),
  ).not.toThrow();
  for (const changed of [
    { target: base },
    { base: target },
    { tag: "v2.0.0" },
    { head: target },
  ]) {
    expect(() =>
      validatePublication(published, { ...published, ...changed }),
    ).toThrow();
  }
  expect(() =>
    validatePublication(
      { ...published, repair: 1 },
      { ...published, repair: 1, head: target },
    ),
  ).toThrow();
});

test("publisher reconstructs an adapted conflicting merge without losing source ancestry or bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "world-upstream-test-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", directory, "-c", "core.hooksPath=/dev/null", ...args],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trimEnd();
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Example Agent");
    git("config", "user.email", "agent@example.invalid");
    writeFileSync(join(directory, "shared.txt"), "foundation\n");
    writeFileSync(join(directory, "removed.txt"), "old\n");
    git("add", ".");
    git("commit", "-m", "Foundation");
    git("checkout", "-b", "source");
    writeFileSync(join(directory, "shared.txt"), "upstream behavior\n");
    git("commit", "-am", "Upstream feature");
    const source = git("rev-parse", "HEAD");
    git("checkout", "main");
    writeFileSync(join(directory, "shared.txt"), "World behavior\n");
    git("commit", "-am", "Downstream behavior");
    const start = git("rev-parse", "HEAD");
    expect(() => git("merge", "--no-commit", "--no-ff", source)).toThrow();
    writeFileSync(
      join(directory, "shared.txt"),
      "adapted World and upstream behavior  \n",
    );
    writeFileSync(join(directory, "binary.dat"), Buffer.from([0, 1, 255, 42]));
    rmSync(join(directory, "removed.txt"));
    git("add", "--all");
    const tree = git("write-tree");
    const patch = execFileSync("git", [
      "-C",
      directory,
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      start,
    ]);
    git("merge", "--abort");
    const patchPath = join(directory, ".git/candidate.patch");
    writeFileSync(patchPath, patch);
    reconstructMerge(source, patchPath, directory);
    expect(git("write-tree")).toBe(tree);
    git("commit", "-m", "Adapt upstream");
    expect(
      git("rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1),
    ).toEqual([start, source]);
    expect(readFileSync(join(directory, "binary.dat"))).toEqual(
      Buffer.from([0, 1, 255, 42]),
    );
    expect(readFileSync(join(directory, "shared.txt"), "utf8")).toEndWith(
      "  \n",
    );
    expect(() =>
      git("merge-base", "--is-ancestor", source, "HEAD"),
    ).not.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = {
  on: Record<string, unknown>;
  concurrency: { "cancel-in-progress": boolean };
  jobs: Record<
    string,
    {
      permissions?: Record<string, string>;
      needs?: string | string[];
      if?: string;
      steps: Step[];
    }
  >;
};
async function workflow(name: string): Promise<Workflow> {
  return Bun.YAML.parse(
    await Bun.file(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
    ).text(),
  ) as Workflow;
}

describe("GitHub/local authority boundaries", () => {
  test("hosted detection queues work without a model or OpenAI credentials", async () => {
    const syncWorkflow = await workflow("upstream-sync");
    expect(syncWorkflow.on.schedule).toEqual([{ cron: "17 * * * *" }]);
    expect(syncWorkflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(Object.keys(syncWorkflow.jobs)).toEqual(["detect"]);
    for (const name of [
      "upstream-sync",
      "upstream-publish",
      "upstream-review",
    ]) {
      const definition = await workflow(name);
      for (const job of Object.values(definition.jobs)) {
        expect(job.steps.some((step) => step.uses?.startsWith("openai/"))).toBe(
          false,
        );
        expect(JSON.stringify(job)).not.toContain("OPENAI_API_KEY");
      }
    }
  });

  test("publication executes trusted-main helpers without checking out candidate code", async () => {
    const { publish } = (await workflow("upstream-publish")).jobs;
    expect(
      publish.steps.some((step) => step.run?.includes("bun install")),
    ).toBe(false);
    const checkout = publish.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    )!;
    expect(checkout.with?.ref).toBeUndefined();
    expect(
      publish.steps.some((step) => step.run?.includes("publish-head")),
    ).toBe(true);
  });

  test("separate App identity submits a revision-bound verdict before normal auto-merge", async () => {
    const reviewWorkflow = await workflow("upstream-review");
    const { approve } = reviewWorkflow.jobs;
    expect(approve.needs).toBe("plan");
    expect(approve.if).toContain("workflow_dispatch");
    const submit = approve.steps.find(
      (step) => step.name === "Submit revision-bound independent review",
    )!;
    expect(submit.env?.GH_TOKEN).toBe("${{ steps.reviewer.outputs.token }}");
    expect(submit.env?.REVIEW_BASE).toBe("${{ inputs.base }}");
    const merge = approve.steps.find(
      (step) => step.name === "Queue merge under existing branch rules",
    )!;
    expect(merge.run).toContain("--match-head-commit");
    expect(merge.run).toContain("--auto --merge");
    expect(merge.run).not.toContain("--admin");
  });
});
