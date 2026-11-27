import { expect, test } from "bun:test";
import { isDocumentationPath } from "./validation-scope";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baseChanged,
  canReuseFullCheck,
  checkoutCommitFromLog,
  HOLD_STEP,
  isDocsOnlyChange,
  isEarlierBase,
  redHeadResult,
  selectValidationMode,
  STABILITY_LABEL,
  stabilityLabelAdded,
  treeEvidence,
  writeValidationOutputs,
} from "./ci-reuse-full-check";

const base = "a".repeat(40);
const head = "b".repeat(40);
const pr = { number: 126, base: { sha: base }, head: { sha: head } };
const run = (
  id: number,
  baseSha = base,
  conclusion: string | null = "success",
) => ({
  id,
  run_attempt: 1,
  head_sha: head,
  conclusion,
  pull_requests: [{ ...pr, base: { sha: baseSha } }],
});
const job = (full: string, result = "success", reused = false) => ({
  id: 7,
  run_attempt: 1,
  name: "Delivery checks",
  conclusion: result,
  steps: [
    {
      name: "Determine validation scope",
      conclusion: reused ? "success" : "skipped",
    },
    { name: "Run full repository check", conclusion: full },
  ],
});
const verify = (
  runs: ReturnType<typeof run>[],
  jobs: Record<number, Array<ReturnType<typeof job> & { run_id?: number }>>,
  parents = [base, head],
  commitSha = "d".repeat(40),
  earlierBase?: (sha: string) => Promise<boolean>,
) =>
  canReuseFullCheck(
    runs,
    4,
    126,
    base,
    head,
    "Delivery checks",
    "Run full repository check",
    async (id) =>
      (jobs[id] ?? []).map((job) => ({ ...job, run_id: job.run_id ?? id })),
    async () => ({ checkoutSha: "d".repeat(40), commitSha, parents }),
    undefined,
    earlierBase,
  );

test("mutable PR associations cannot substitute a different tested base", async () => {
  const runs = [run(3)];
  const jobs = { 3: [job("success")] };
  expect(await verify(runs, jobs, ["c".repeat(40), head])).toBe(false);
  expect(await verify(runs, jobs, [base, "c".repeat(40)])).toBe(false);
  expect(await verify(runs, jobs, [head, base])).toBe(false);
  expect(await verify(runs, jobs, [base, head, base])).toBe(false);
  expect(await verify(runs, jobs, [])).toBe(false);
  expect(await verify(runs, jobs, [base, head], "e".repeat(40))).toBe(false);
  expect(
    await verify(runs, { 3: [{ ...job("success"), run_attempt: 2 }] }),
  ).toBe(false);
  expect(await verify(runs, { 3: [{ ...job("success"), run_id: 99 }] })).toBe(
    false,
  );
  expect(await verify(runs, jobs, [base, head])).toBe(true);
});

test("checkout proof requires the full unambiguous immutable commit", () => {
  const proof = (sha: string) =>
    `##[group]Run actions/checkout@synthetic\n2026-01-01T00:00:00.000Z [command]/usr/bin/git log -1 --format=%H\n2026-01-01T00:00:00.001Z ${sha}\n`;
  expect(checkoutCommitFromLog(proof(head))).toBe(head);
  expect(
    checkoutCommitFromLog(`HEAD is now at ${head.slice(0, 8)}`),
  ).toBeUndefined();
  expect(checkoutCommitFromLog(head)).toBeUndefined();
  expect(checkoutCommitFromLog(proof(head) + proof(base))).toBeUndefined();
  expect(checkoutCommitFromLog(proof("not-a-commit"))).toBeUndefined();
  expect(
    checkoutCommitFromLog(
      proof(head).replace(
        "Run actions/checkout@synthetic",
        "Run arbitrary script",
      ),
    ),
  ).toBeUndefined();
  expect(
    checkoutCommitFromLog(
      proof(head) +
        "##[group]Run later script\n[command]/usr/bin/git log -1 --format=%H\n" +
        base,
    ),
  ).toBe(head);
});

test("metadata events reuse proof while code events always validate", async () => {
  for (const action of ["edited", "labeled"]) {
    expect(await selectValidationMode(action, false, async () => true)).toBe(
      "reuse",
    );
    expect(await selectValidationMode(action, false, async () => false)).toBe(
      "full",
    );
    expect(
      await selectValidationMode(action, false, async () => {
        throw new Error("API unavailable");
      }),
    ).toBe("full");
  }
  for (const action of ["opened", "synchronize", "reopened", undefined]) {
    expect(
      await selectValidationMode(action, false, async () => {
        throw new Error("must not query reuse");
      }),
    ).toBe("full");
  }
  expect(await selectValidationMode("labeled", true, async () => true)).toBe(
    "reuse",
  );
  expect(await selectValidationMode("labeled", true, async () => false)).toBe(
    "docs",
  );
});

test("browser stability requests fresh full evidence on its label and base changes", async () => {
  let queried = 0;
  for (const [action, newBase, added] of [
    ["opened", false, false],
    ["labeled", false, true],
    ["edited", true, false],
  ] as const)
    for (const [docs, tooling, scoped] of [
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ] as const)
      expect(
        await selectValidationMode(
          action,
          docs,
          async () => {
            queried++;
            return true;
          },
          tooling,
          scoped,
          true,
          newBase,
          added,
        ),
      ).toBe("full");
  expect(queried).toBe(0);
  // Another label on a stability PR keeps the head's stability verdict.
  expect(
    await selectValidationMode(
      "labeled",
      false,
      async () => true,
      false,
      false,
      true,
    ),
  ).toBe("reuse");
  expect(
    await selectValidationMode(
      "labeled",
      false,
      async () => false,
      false,
      false,
      true,
    ),
  ).toBe("full");
  expect(stabilityLabelAdded({ label: { name: STABILITY_LABEL } })).toBe(true);
  expect(stabilityLabelAdded({ label: { name: "release-preview" } })).toBe(
    false,
  );
  expect(stabilityLabelAdded({ action: "edited" })).toBe(false);
  expect(stabilityLabelAdded(null)).toBe(false);
});

test("a title or description edit reuses exact-revision proof in every mode", async () => {
  for (const [docs, tooling, scoped, stability] of [
    [false, false, false, false],
    [true, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, true],
  ] as const) {
    expect(
      await selectValidationMode(
        "edited",
        docs,
        async () => true,
        tooling,
        scoped,
        stability,
      ),
    ).toBe("reuse");
    // Without passing proof the edit validates afresh exactly as before.
    expect(
      await selectValidationMode(
        "edited",
        docs,
        async () => false,
        tooling,
        scoped,
        stability,
      ),
    ).toBe(
      stability
        ? "full"
        : tooling
          ? "tooling"
          : docs
            ? "docs"
            : scoped
              ? "scoped"
              : "full",
    );
  }
});

test("a new base branch is a new merge and never reuses", async () => {
  for (const scoped of [false, true])
    expect(
      await selectValidationMode(
        "edited",
        false,
        async () => {
          throw new Error("a base change must not query reuse");
        },
        false,
        scoped,
        false,
        true,
      ),
    ).toBe(scoped ? "scoped" : "full");
  expect(
    baseChanged({
      action: "edited",
      changes: { base: { ref: { from: "main" } } },
    }),
  ).toBe(true);
  expect(
    baseChanged({ action: "edited", changes: { body: { from: "old" } } }),
  ).toBe(false);
  expect(
    baseChanged({ action: "edited", changes: { title: { from: "old" } } }),
  ).toBe(false);
  expect(baseChanged({ action: "synchronize" })).toBe(false);
  expect(baseChanged(null)).toBe(false);
});

test("metadata edits reuse the latest successful full check on the exact base and head", async () => {
  expect(
    await verify([run(4), run(3), run(2)], {
      3: [job("skipped", "success", true)],
      2: [job("success")],
    }),
  ).toBe(true);
  expect(
    await verify([run(4), run(3, "c".repeat(40)), run(2)], {
      3: [job("success")],
      2: [job("success")],
    }),
  ).toBe(true);
});

test("a newer failed full gate cannot be hidden by an older success", async () => {
  expect(
    await verify([run(4), run(3), run(2)], {
      3: [job("failure", "failure")],
      2: [job("success")],
    }),
  ).toBe(false);
  expect(
    await verify([run(4), run(3)], { 3: [job("skipped", "failure")] }),
  ).toBe(false);
  expect(await verify([run(4)], {})).toBe(false);
});

const scopeJob = (description: string, scope: string, result = "failure") => ({
  id: 8,
  run_attempt: 1,
  name: "Validation scope",
  conclusion: result,
  steps: [
    { name: "Check PR description", conclusion: description },
    { name: "Determine validation scope", conclusion: scope },
  ],
});

test("a run stopped by its description does not hide older code evidence", async () => {
  // Green code, then a description check failure, then a corrected description.
  const stopped = {
    3: [scopeJob("failure", "skipped"), job("failure", "failure")],
  };
  expect(
    await verify([run(4), run(3, base, "failure"), run(2)], {
      ...stopped,
      2: [job("success")],
    }),
  ).toBe(true);
  expect(
    await selectValidationMode("edited", false, () =>
      verify([run(4), run(3, base, "failure"), run(2)], {
        ...stopped,
        2: [job("success")],
      }),
    ),
  ).toBe("reuse");
  // Without older evidence the correction validates afresh.
  expect(await verify([run(4), run(3, base, "failure")], stopped)).toBe(false);
  // An older code failure stays a barrier behind the description failure.
  expect(
    await verify(
      [run(4), run(3, base, "failure"), run(2, base, "failure"), run(1)],
      {
        ...stopped,
        2: [
          scopeJob("success", "success", "success"),
          job("failure", "failure"),
        ],
        1: [job("success")],
      },
    ),
  ).toBe(false);
});

test("only a description failure that chose no scope is passed over", async () => {
  const older = { 2: [job("success")] };
  const barrier = (
    jobs: ReturnType<typeof scopeJob>[],
    conclusion: string | null = "failure",
  ) =>
    verify([run(4), run(3, base, conclusion), run(2)], { 3: jobs, ...older });
  // Code jobs failed after a passing description and scope.
  expect(await barrier([scopeJob("success", "success", "success")])).toBe(
    false,
  );
  // The scope step itself failed.
  expect(await barrier([scopeJob("success", "failure")])).toBe(false);
  // The scope was chosen despite a failed description step.
  expect(await barrier([scopeJob("failure", "success")])).toBe(false);
  // New CI chooses scope independently: a failed description leaf cannot
  // conceal a code failure in the same run.
  expect(
    await barrier([
      scopeJob("success", "success", "success"),
      { ...scopeJob("failure", "skipped"), name: "PR description" },
    ]),
  ).toBe(false);
  // Unfinished or cancelled runs, and ambiguous or stale scope jobs.
  expect(await barrier([scopeJob("failure", "skipped")], null)).toBe(false);
  expect(await barrier([scopeJob("failure", "skipped")], "cancelled")).toBe(
    false,
  );
  expect(await barrier([])).toBe(false);
  expect(
    await barrier([
      scopeJob("failure", "skipped"),
      scopeJob("failure", "skipped"),
    ]),
  ).toBe(false);
  expect(
    await barrier([{ ...scopeJob("failure", "skipped"), run_attempt: 2 }]),
  ).toBe(false);
});

test("after main moves, a metadata event restores the head's latest verdict on an earlier base", async () => {
  const older = "c".repeat(40);
  const ancestor = async (sha: string) => sha === older;
  const unrelated = async () => false;
  const earlier = [run(4), run(3, older)];
  const green = { 3: [job("success")] };
  // Exact binding alone skips the earlier merge and finds nothing.
  expect(await verify(earlier, green, [older, head])).toBe(false);
  expect(await verify(earlier, green, [older, head], undefined, ancestor)).toBe(
    true,
  );
  // A merge on another branch's commit is not an earlier base.
  expect(
    await verify(earlier, green, [older, head], undefined, unrelated),
  ).toBe(false);
  // The head still binds the tested merge.
  expect(await verify(earlier, green, [older, base], undefined, ancestor)).toBe(
    false,
  );
  // Chains of reused results lead back to the original verdict.
  expect(
    await verify(
      [run(4), run(3, older), run(2, older)],
      { 3: [job("skipped", "success", true)], 2: [job("success")] },
      [older, head],
      undefined,
      ancestor,
    ),
  ).toBe(true);
  // Red stays red: a failure on an earlier base stops the search.
  expect(
    await verify(
      [run(4), run(3, older, "failure"), run(2, older)],
      { 3: [job("failure", "failure")], 2: [job("success")] },
      [older, head],
      undefined,
      ancestor,
    ),
  ).toBe(false);
});

test("an earlier-base scoped verdict is restored without re-deriving its selection", async () => {
  const { selectValidation } = await import("./validation-scope");
  const selection = selectValidation(
    {
      files: new Set(["scripts/example.test.ts"]),
      gone: new Set(),
      deps: new Map(),
    },
    ["scripts/example.test.ts"],
  );
  const older = "c".repeat(40);
  const proof = {
    ...job("skipped", "success", true),
    run_id: 3,
    steps: [
      ...job("skipped", "success", true).steps,
      { name: "Verify applicable or reused results", conclusion: "success" },
    ],
  };
  const attempt = (parents: string[], applicable = "success") =>
    canReuseFullCheck(
      [run(3, older)],
      4,
      126,
      base,
      head,
      "Delivery checks",
      "Run full repository check",
      async () => [
        {
          ...proof,
          steps: proof.steps.map((step) =>
            step.name === "Verify applicable or reused results"
              ? { ...step, conclusion: applicable }
              : step,
          ),
        },
      ],
      async () => ({
        checkoutSha: "d".repeat(40),
        commitSha: "d".repeat(40),
        parents,
        validation: {
          mode: "scoped",
          selection: { ...selection, unit: ["scripts/other.test.ts"] },
        },
      }),
      selection,
      async (sha) => sha === older,
    );
  expect(await attempt([older, head])).toBe(true);
  expect(await attempt([older, head], "failure")).toBe(false);
  // On the current base the selection must still match exactly.
  expect(await attempt([base, head])).toBe(false);
});

test("an earlier base must be the current base or its ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-earlier-base-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "example@example.invalid");
    git("config", "user.name", "Example");
    git("commit", "-q", "--allow-empty", "-m", "first");
    const first = git("rev-parse", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "second");
    const second = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "other", first);
    git("commit", "-q", "--allow-empty", "-m", "other");
    const other = git("rev-parse", "HEAD");
    expect(isEarlierBase(first, second, root)).toBe(true);
    expect(isEarlierBase(second, second, root)).toBe(true);
    expect(isEarlierBase(second, first, root)).toBe(false);
    expect(isEarlierBase(other, second, root)).toBe(false);
    expect(isEarlierBase("--all", second, root)).toBe(false);
    expect(() => isEarlierBase("f".repeat(40), second, root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("documentation scope follows the PR diff and includes nested Markdown", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-doc-scope-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "example@example.invalid");
    git("config", "user.name", "Example");
    writeFileSync(join(root, "README.md"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const baseSha = git("rev-parse", "HEAD");
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "guide.md"), "documentation\n");
    git("add", ".");
    git("commit", "-qm", "docs");
    expect(isDocsOnlyChange(baseSha, git("rev-parse", "HEAD"), root)).toBe(
      true,
    );
    writeFileSync(join(root, "code.ts"), "export const value = 1;\n");
    git("add", ".");
    git("commit", "-qm", "code");
    expect(isDocsOnlyChange(baseSha, git("rev-parse", "HEAD"), root)).toBe(
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("behavioral contracts and packaged notices cannot take the Markdown shortcut", () => {
  for (const path of [
    "verification/contracts/runtime-leases.md",
    "quint/README.md",
    "tools/quint/DEPENDENCY_NOTICES.md",
    "openspec/specs/runtime-federation/spec.md",
    "openspec/changes/archive/2026-10-14-adopt-quint-behavioral-verification/tasks.md",
    "THIRD_PARTY_NOTICES.md",
    "DEPENDENCY_NOTICES.md",
    "DEPENDENCY_LICENSES.md",
    "UPSTREAM.md",
  ])
    expect(isDocumentationPath(path)).toBe(false);
  for (const path of [
    "README.md",
    "docs/guide.md",
    "CHANGELOG.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".agents/skills/candidate-delivery/SKILL.md",
  ])
    expect(isDocumentationPath(path)).toBe(true);
});

test("tooling mode validates every code event afresh without querying reuse", async () => {
  expect(
    await selectValidationMode("labeled", false, async () => true, true),
  ).toBe("reuse");
  expect(
    await selectValidationMode("labeled", false, async () => false, true),
  ).toBe("tooling");
  for (const action of ["opened", "synchronize", "reopened"]) {
    expect(
      await selectValidationMode(
        action,
        false,
        async () => {
          throw new Error("must not reuse");
        },
        true,
      ),
    ).toBe("tooling");
  }
});

test("classified PRs use fresh scoped validation, while unknown changes retain full validation", async () => {
  for (const action of [
    "opened",
    "synchronize",
    "reopened",
    "edited",
    "labeled",
  ]) {
    expect(
      await selectValidationMode(action, false, async () => false, false, true),
    ).toBe("scoped");
    expect(await selectValidationMode(action, false, async () => false)).toBe(
      "full",
    );
  }
  expect(
    await selectValidationMode("edited", false, async () => true, false, true),
  ).toBe("reuse");
});

test("unmatched main pushes report missing evidence without starting any heavy lane", () => {
  const root = mkdtempSync(join(tmpdir(), "main-scope-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    writeFileSync(join(root, "README.md"), "base\n");
    mkdirSync(join(root, "verification/coverage"), { recursive: true });
    writeFileSync(
      join(root, "verification/coverage/_meta.json"),
      '{"schemaVersion":1}',
    );
    git("add", ".");
    git("commit", "-qm", "base");
    writeFileSync(join(root, "README.md"), "dirty docs\n");
    const output = join(root, "outputs");
    const result = spawnSync(
      process.execPath,
      [new URL("./ci-reuse-full-check.ts", import.meta.url).pathname],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "push",
          GITHUB_OUTPUT: output,
        },
      },
    );
    expect(result.status).toBe(0);
    const fields = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
    expect(fields).toMatchObject({
      mode: "hold",
      world: "false",
      verification: "false",
      packaging: "false",
    });
    expect(JSON.parse(fields.selection!).full).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(["scoped", "docs", "tooling"])(
  "metadata can reuse a passing %s merge only with the identical selection",
  async (mode) => {
    const { selectValidation } = await import("./validation-scope");
    const selection = selectValidation(
      {
        files: new Set(["scripts/example.test.ts"]),
        gone: new Set(),
        deps: new Map(),
      },
      ["scripts/example.test.ts"],
    );
    const proof = {
      ...job("skipped", "success", true),
      run_id: 3,
      steps: [
        ...job("skipped", "success", true).steps,
        { name: "Verify applicable or reused results", conclusion: "success" },
      ],
    };
    const attempt = (
      recorded = selection,
      result = "success",
      parents = [base, head],
    ) =>
      canReuseFullCheck(
        [run(3)],
        4,
        126,
        base,
        head,
        "Delivery checks",
        "Run full repository check",
        async () => [{ ...proof, conclusion: result }],
        async () => ({
          checkoutSha: "d".repeat(40),
          commitSha: "d".repeat(40),
          parents,
          validation: { mode, selection: recorded },
        }),
        selection,
      );
    expect(await attempt()).toBe(true);
    expect(
      await attempt({ ...selection, verification: !selection.verification }),
    ).toBe(false);
    expect(await attempt({ ...selection, unit: ["scripts/new.test.ts"] })).toBe(
      false,
    );
    expect(await attempt(selection, "failure")).toBe(false);
    expect(await attempt(selection, "cancelled")).toBe(false);
    expect(await attempt(selection, "success", [head, base])).toBe(false);
  },
);

test.each(["full", "scoped"])(
  "a newer unsuccessful workflow without a Delivery job blocks older %s success",
  async (mode) => {
    const { selectValidation } = await import("./validation-scope");
    const selection = selectValidation(
      {
        files: new Set(["scripts/example.test.ts"]),
        gone: new Set(),
        deps: new Map(),
      },
      ["scripts/example.test.ts"],
    );
    for (const conclusion of [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "startup_failure",
      "stale",
      "skipped",
      null,
    ]) {
      const result = await canReuseFullCheck(
        [run(3, base, conclusion), run(2)],
        4,
        126,
        base,
        head,
        "Delivery checks",
        "Run full repository check",
        async (id) =>
          id === 3
            ? []
            : [
                {
                  ...job(
                    mode === "full" ? "success" : "skipped",
                    "success",
                    mode === "scoped",
                  ),
                  run_id: id,
                  steps: [
                    ...job(
                      mode === "full" ? "success" : "skipped",
                      "success",
                      mode === "scoped",
                    ).steps,
                    {
                      name: "Verify applicable or reused results",
                      conclusion: "success",
                    },
                  ],
                },
              ],
        async () => ({
          checkoutSha: "d".repeat(40),
          commitSha: "d".repeat(40),
          parents: [base, head],
          validation: { mode, selection },
        }),
        selection,
      );
      expect(result).toBe(false);
    }
  },
);

const tree = "f".repeat(40);
const other = "e".repeat(40);
const merge = "d".repeat(40);
const finished = (id: number, conclusion: string | null = "success") => ({
  ...run(id, base, conclusion),
  head_sha: "c".repeat(40),
});
const treeScopeJob = (
  id: number,
  conclusion = "success",
  steps?: string[],
) => ({
  id: id * 10,
  run_id: id,
  run_attempt: 1,
  name: "Validation scope",
  conclusion,
  steps: [
    { name: "Check PR description", conclusion: steps?.[0] ?? "success" },
    { name: "Determine validation scope", conclusion: steps?.[1] ?? "success" },
  ],
});
const treeDeliveryJob = (
  id: number,
  full = "success",
  applicable = "skipped",
) => ({
  id: id * 10 + 1,
  run_id: id,
  run_attempt: 1,
  name: "Delivery checks",
  conclusion: "success",
  steps: [
    { name: "Run full repository check", conclusion: full },
    { name: "Verify applicable or reused results", conclusion: applicable },
  ],
});
const selection = {
  reason: "synthetic",
  full: false,
  tooling: false,
  documentation: false,
  verification: false,
  packaging: false,
  unit: ["scripts/a.test.ts"],
  world: [],
  web: [],
  worldShards: [],
};
const sameTree = (
  runs: ReturnType<typeof finished>[],
  jobs: Record<number, Array<Record<string, unknown>>>,
  trees: Record<number, string | undefined>,
  proofs: Record<number, { mode: string; selection: typeof selection }> = {},
  options: {
    requireFull: boolean;
    selection?: typeof selection;
    acceptScoped?: boolean;
  } = {
    requireFull: true,
  },
) =>
  treeEvidence(
    runs,
    99,
    tree,
    "Delivery checks",
    "Run full repository check",
    async (id) => (jobs[id] ?? []) as never,
    async (jobId) => {
      const runId = Math.floor(jobId / 10);
      return {
        checkoutSha: merge,
        commitSha: merge,
        parents: [base, head],
        tree: trees[runId],
        validation:
          jobId % 10 === 1
            ? (proofs[runId] ?? { mode: "full", selection })
            : undefined,
      };
    },
    options,
  );

test("a main commit reuses only a passing full run that tested its exact tree", async () => {
  const green = { 5: [treeScopeJob(5), treeDeliveryJob(5)] };
  expect(await sameTree([finished(5)], green, { 5: tree })).toBe(5);
  // A different tree is different code, whatever the PR association says.
  expect(await sameTree([finished(5)], green, { 5: other })).toBeUndefined();
  // A red, cancelled or scoped verdict on this tree is never turned green.
  for (const conclusion of ["failure", "cancelled"])
    expect(
      await sameTree(
        [finished(6, conclusion), finished(5)],
        {
          ...green,
          6: [treeScopeJob(6), treeDeliveryJob(6)],
        },
        { 5: tree, 6: tree },
      ),
    ).toBeUndefined();
  expect(
    await sameTree(
      [finished(5)],
      { 5: [treeScopeJob(5), treeDeliveryJob(5, "skipped", "success")] },
      { 5: tree },
      {
        5: { mode: "scoped", selection },
      },
    ),
  ).toBeUndefined();
  expect(
    await sameTree(
      [finished(5)],
      { 5: [treeScopeJob(5), treeDeliveryJob(5, "failure")] },
      { 5: tree },
    ),
  ).toBeUndefined();
  // Newer runs on other trees and unfinished runs do not hide the evidence.
  expect(
    await sameTree(
      [finished(7, "failure"), finished(8, null), finished(5)],
      { ...green, 7: [treeScopeJob(7)], 8: [] },
      { 5: tree, 7: other },
    ),
  ).toBe(5);
  // A red run whose tested tree is unknown may have tested this one.
  expect(
    await sameTree(
      [finished(7, "failure"), finished(5)],
      { ...green, 7: [treeScopeJob(7)] },
      { 5: tree },
    ),
  ).toBeUndefined();
  // A description failure tested no code.
  expect(
    await sameTree(
      [finished(7, "failure"), finished(5)],
      { ...green, 7: [treeScopeJob(7, "failure", ["failure", "skipped"])] },
      { 5: tree },
    ),
  ).toBe(5);
  // A reused result is not evidence of its own tree; the older proof is.
  expect(
    await sameTree(
      [finished(6), finished(5)],
      {
        ...green,
        6: [treeScopeJob(6), treeDeliveryJob(6, "skipped", "success")],
      },
      { 5: tree, 6: tree },
      { 6: { mode: "reuse", selection } },
    ),
  ).toBe(5);
  // The Delivery job must have checked out the same tree in this attempt.
  expect(
    await sameTree(
      [finished(5)],
      { 5: [treeScopeJob(5), { ...treeDeliveryJob(5), run_attempt: 2 }] },
      { 5: tree },
    ),
  ).toBeUndefined();
  expect(
    await sameTree([finished(99)], { 99: green[5] }, { 99: tree }),
  ).toBeUndefined();
  expect(
    await sameTree(
      [finished(5)],
      green,
      { 5: tree },
      {},
      { requireFull: true },
    ),
  ).toBe(5);
});

test("main may reuse scoped passing evidence of the identical tree without requiring its old PR scope", async () => {
  const jobs = {
    5: [treeScopeJob(5), treeDeliveryJob(5, "skipped", "success")],
  };
  const proof = { 5: { mode: "scoped", selection } };
  expect(
    await sameTree([finished(5)], jobs, { 5: tree }, proof, {
      requireFull: false,
      acceptScoped: true,
    }),
  ).toBe(5);
  expect(
    await sameTree([finished(5)], jobs, { 5: other }, proof, {
      requireFull: false,
      acceptScoped: true,
    }),
  ).toBeUndefined();
  expect(
    await sameTree([finished(5, "failure")], jobs, { 5: tree }, proof, {
      requireFull: false,
      acceptScoped: true,
    }),
  ).toBeUndefined();
});

test("a PR re-push of an identical tree reuses scoped evidence only with the same selection", async () => {
  const jobs = {
    5: [treeScopeJob(5), treeDeliveryJob(5, "skipped", "success")],
  };
  const proofs = { 5: { mode: "scoped", selection } };
  expect(
    await sameTree([finished(5)], jobs, { 5: tree }, proofs, {
      requireFull: false,
      selection,
    }),
  ).toBe(5);
  expect(
    await sameTree([finished(5)], jobs, { 5: tree }, proofs, {
      requireFull: false,
      selection: { ...selection, unit: ["scripts/b.test.ts"] },
    }),
  ).toBeUndefined();
  expect(
    await sameTree([finished(5)], jobs, { 5: tree }, proofs, {
      requireFull: false,
    }),
  ).toBeUndefined();
});

test("a new commit tries tree reuse unless the stability label asks for fresh runs", async () => {
  const yes = async () => true;
  for (const action of ["opened", "synchronize", "reopened"]) {
    expect(
      await selectValidationMode(
        action,
        false,
        yes,
        false,
        true,
        false,
        false,
        false,
        yes,
      ),
    ).toBe("reuse");
    expect(
      await selectValidationMode(
        action,
        false,
        yes,
        false,
        true,
        true,
        false,
        false,
        yes,
      ),
    ).toBe("full");
    expect(
      await selectValidationMode(
        action,
        false,
        yes,
        false,
        true,
        false,
        false,
        false,
        async () => {
          throw new Error("API unavailable");
        },
      ),
    ).toBe("scoped");
  }
  // A base change is a new merge and never reuses by tree either.
  expect(
    await selectValidationMode(
      "edited",
      false,
      yes,
      false,
      false,
      false,
      true,
      false,
      yes,
    ),
  ).toBe("full");
});

const heldScopeJob = (id = 0) => ({
  id: id * 10 || 8,
  ...(id ? { run_id: id } : {}),
  run_attempt: 1,
  name: "Validation scope",
  conclusion: "failure",
  steps: [
    { name: "Check PR description", conclusion: "success" },
    { name: "Determine validation scope", conclusion: "success" },
    { name: HOLD_STEP, conclusion: "failure" },
  ],
});
const red = (
  runs: ReturnType<typeof run>[],
  jobs: Record<number, Array<Record<string, unknown>>> = {},
) =>
  redHeadResult(
    runs,
    4,
    126,
    head,
    async (id) =>
      (jobs[id] ?? []).map((job) => ({ run_id: id, ...job })) as never,
  );

const descriptionLeafFailure = () => [
  {
    ...treeScopeJob(3),
    steps: [{ name: "Determine validation scope", conclusion: "success" }],
  },
  {
    ...treeDeliveryJob(3),
    id: 32,
    name: "PR description",
    conclusion: "failure",
    steps: [{ name: "Check PR description", conclusion: "failure" }],
  },
  { ...treeDeliveryJob(3), conclusion: "failure" },
  { ...treeDeliveryJob(3), id: 33, name: "Static checks" },
  {
    ...treeDeliveryJob(3),
    id: 34,
    name: "World browser shard 1",
    conclusion: "skipped",
  },
];

test("a corrected description can validate after only the description leaf failed", async () => {
  const runs = [run(4), run(3, base, "failure")];
  const jobs = { 3: descriptionLeafFailure() };
  expect(await red(runs, jobs)).toBeUndefined();
  for (const action of ["labeled", "edited"])
    for (const scoped of [true, false])
      expect(
        await selectValidationMode(
          action,
          false,
          () => verify(runs, jobs),
          false,
          scoped,
          false,
          false,
          false,
          undefined,
          async () => (await red(runs, jobs)) !== undefined,
        ),
      ).toBe(scoped ? "scoped" : "full");
  // Failed Delivery is still no reusable evidence, even with an older pass.
  expect(
    await verify([...runs, run(2)], { ...jobs, 2: [job("success")] }),
  ).toBe(false);
  expect(
    await sameTree(
      [finished(3, "failure"), finished(2)],
      { ...jobs, 2: [treeScopeJob(2), treeDeliveryJob(2)] },
      { 3: tree, 2: tree },
    ),
  ).toBeUndefined();
});

test("failed-jobs reruns still permit corrected-description fresh validation", async () => {
  for (const attempt of [2, 3]) {
    const runs = [run(4), { ...run(3, base, "failure"), run_attempt: attempt }];
    const carried = descriptionLeafFailure().map((entry) => ({
      ...entry,
      run_attempt:
        entry.name === "PR description" || entry.name === "Delivery checks"
          ? attempt
          : 1,
    }));
    const jobs = { 3: carried };
    expect(await red(runs, jobs)).toBeUndefined();
    for (const action of ["labeled", "edited"])
      expect(
        await selectValidationMode(
          action,
          false,
          () => verify(runs, jobs),
          false,
          true,
          false,
          false,
          false,
          undefined,
          async () => (await red(runs, jobs)) !== undefined,
        ),
      ).toBe("scoped");
    // Recovery must never convert failed Delivery into reusable evidence.
    expect(
      await verify([...runs, run(2)], { ...jobs, 2: [job("success")] }),
    ).toBe(false);
    for (const [index, entry] of carried.entries()) {
      for (const invalid of [
        0,
        -1,
        1.5,
        attempt + 1,
        ...(entry.conclusion === "failure" ? [attempt - 1] : []),
      ])
        expect(
          await red(runs, {
            3: carried.map((job, i) =>
              i === index ? { ...job, run_attempt: invalid } : job,
            ),
          }),
        ).toBe(3);
      expect(
        await red(runs, {
          3: carried.map((job, i) =>
            i === index ? { ...job, run_id: 2 } : job,
          ),
        }),
      ).toBe(3);
    }
  }
});

test("a description-only leaf failure does not hide an older red head", async () => {
  const runs = [run(4), run(3, base, "failure"), run(2, base, "failure")];
  const jobs = {
    3: descriptionLeafFailure(),
    2: [scopeJob("success", "success", "success")],
  };
  expect(await red(runs, jobs)).toBe(2);
  expect(
    await selectValidationMode(
      "labeled",
      false,
      () => verify(runs, jobs),
      false,
      true,
      false,
      false,
      false,
      undefined,
      async () => (await red(runs, jobs)) !== undefined,
    ),
  ).toBe("hold");
});

test("description recovery keeps code failures and incomplete job evidence red", async () => {
  const runs = [run(4), run(3, base, "failure")];
  const original = descriptionLeafFailure();
  for (const [index, candidate] of original.entries()) {
    for (const conclusion of [
      "failure",
      "cancelled",
      "timed_out",
      "success",
      "skipped",
      null,
    ]) {
      const allowed =
        index === 0
          ? conclusion === "success"
          : index <= 2
            ? conclusion === "failure"
            : conclusion === "success" || conclusion === "skipped";
      expect(
        await red(runs, {
          3: original.map((entry, i) =>
            i === index ? { ...entry, conclusion } : entry,
          ),
        }),
      ).toBe(allowed ? undefined : 3);
    }
    for (const stale of [{ run_id: 2 }, { run_attempt: 2 }])
      expect(
        await red(runs, {
          3: original.map((entry, i) =>
            i === index ? { ...entry, ...stale } : entry,
          ),
        }),
      ).toBe(3);
    if (index > 2) continue;
    expect(await red(runs, { 3: original.filter((_, i) => i !== index) })).toBe(
      3,
    );
    expect(await red(runs, { 3: [...original, candidate] })).toBe(3);
    if (index === 2) continue;
    for (const conclusion of ["failure", "skipped", "success", null]) {
      const expected = index === 0 ? "success" : "failure";
      expect(
        await red(runs, {
          3: original.map((entry, i) =>
            i === index
              ? { ...entry, steps: [{ ...entry.steps[0], conclusion }] }
              : entry,
          ),
        }),
      ).toBe(conclusion === expected ? undefined : 3);
    }
    expect(
      await red(runs, {
        3: original.map((entry, i) =>
          i === index ? { ...entry, steps: [] } : entry,
        ),
      }),
    ).toBe(3);
  }
});

test("a metadata event on a red head holds that result instead of retesting", async () => {
  // #1373: the push run went red when GitHub cancelled a macOS job that got no
  // runner; the description edit queued behind it ran every job again.
  const pushed = [run(4), run(3, base, "failure")];
  const failed = { 3: [scopeJob("success", "success", "success")] };
  expect(await red(pushed, failed)).toBe(3);
  for (const action of ["edited", "labeled"])
    expect(
      await selectValidationMode(
        action,
        false,
        async () => false,
        false,
        true,
        false,
        false,
        false,
        undefined,
        async () => (await red(pushed, failed)) !== undefined,
      ),
    ).toBe("hold");
  // On an earlier base too: the edit changed no code.
  expect(await red([run(4), run(3, "c".repeat(40), "timed_out")], failed)).toBe(
    3,
  );
  // A pass, a cancelled or an unfinished run is no red result to hold.
  for (const conclusion of ["success", "cancelled", null])
    expect(await red([run(4), run(3, base, conclusion)], failed)).toBe(
      undefined,
    );
  // Nothing tested yet, or only a refused description: validate.
  expect(await red([run(4)])).toBeUndefined();
  expect(
    await red([run(4), run(3, base, "failure")], {
      3: [scopeJob("failure", "skipped")],
    }),
  ).toBeUndefined();
  // Another head or another PR is not this head's result.
  expect(
    await red([run(4), { ...run(3, base, "failure"), head_sha: base }], failed),
  ).toBeUndefined();
  expect(
    await red(
      [
        run(4),
        {
          ...run(3, base, "failure"),
          pull_requests: [{ ...pr, number: 127 }],
        },
      ],
      failed,
    ),
  ).toBeUndefined();
  // A held run is passed over: the result it held decides.
  expect(
    await red([run(4), run(3, base, "failure"), run(2, base, "failure")], {
      3: [heldScopeJob()],
      2: failed[3],
    }),
  ).toBe(2);
  expect(
    await red([run(4), run(3, base, "failure"), run(2)], {
      3: [heldScopeJob()],
    }),
  ).toBeUndefined();
  // A commit, a new base or the stability label never holds; nor does an
  // unreadable answer, which validates as before.
  const hold = async () => true;
  for (const [action, newBase, added] of [
    ["synchronize", false, false],
    ["edited", true, false],
    ["labeled", false, true],
  ] as const)
    expect(
      await selectValidationMode(
        action,
        false,
        async () => false,
        false,
        false,
        false,
        newBase,
        added,
        undefined,
        hold,
      ),
    ).toBe("full");
  expect(
    await selectValidationMode(
      "edited",
      false,
      async () => false,
      false,
      false,
      false,
      false,
      false,
      undefined,
      async () => {
        throw new Error("API unavailable");
      },
    ),
  ).toBe("full");
  // Passing proof still wins.
  expect(
    await selectValidationMode(
      "edited",
      false,
      async () => true,
      false,
      false,
      false,
      false,
      false,
      undefined,
      hold,
    ),
  ).toBe("reuse");
});

test("a held run neither hides a rerun's green result nor counts as evidence", async () => {
  // The red run was rerun and passed; the held run between is no barrier.
  const held = { 3: [heldScopeJob(), job("failure", "failure")] };
  expect(
    await verify([run(4), run(3, base, "failure"), run(2)], {
      ...held,
      2: [job("success")],
    }),
  ).toBe(true);
  // A stale held step from an earlier attempt is not this attempt's hold.
  expect(
    await verify([run(4), run(3, base, "failure"), run(2)], {
      3: [{ ...heldScopeJob(), run_attempt: 2 }],
      2: [job("success")],
    }),
  ).toBe(false);
  // Main and identical-tree reuse pass over it to the run that tested the tree.
  expect(
    await sameTree(
      [finished(6, "failure"), finished(5)],
      {
        5: [treeScopeJob(5), treeDeliveryJob(5)],
        6: [heldScopeJob(6)],
      },
      { 5: tree, 6: tree },
    ),
  ).toBe(5);
});

test("a held result starts no code job", () => {
  const directory = mkdtempSync(join(tmpdir(), "ci-hold-"));
  try {
    const output = join(directory, "output");
    writeFileSync(output, "");
    writeValidationOutputs(output, "hold", {
      full: true,
      tooling: false,
      documentation: false,
      verification: true,
      packaging: true,
      world: ["synthetic"],
      web: [],
    } as never);
    const lines = readFileSync(output, "utf8");
    expect(lines).toContain("mode=hold");
    expect(lines).toContain("world=false");
    expect(lines).toContain("verification=false");
    expect(lines).toContain("packaging=false");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
