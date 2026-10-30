import { expect, test } from "bun:test";
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
  canReuseFullCheck,
  checkoutCommitFromLog,
  isDocsOnlyChange,
  isDocumentationPath,
  selectValidationMode,
} from "./ci-reuse-full-check";

const base = "a".repeat(40);
const head = "b".repeat(40);
const pr = { number: 126, base: { sha: base }, head: { sha: head } };
const run = (id: number, baseSha = base) => ({
  id,
  run_attempt: 1,
  head_sha: head,
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
  expect(
    await selectValidationMode("labeled", true, async () => {
      throw new Error("must not query reuse");
    }),
  ).toBe("docs");
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

test("tooling mode validates every event afresh without querying full-result reuse", async () => {
  for (const action of [
    "opened",
    "synchronize",
    "reopened",
    "edited",
    "labeled",
  ]) {
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

test("every main push forces all suite classes even when a tracked doc is dirty", () => {
  const root = mkdtempSync(join(tmpdir(), "main-scope-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    writeFileSync(join(root, "README.md"), "base\n");
    mkdirSync(join(root, "verification"));
    writeFileSync(join(root, "verification/coverage.json"), '{"areas":[]}');
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
      mode: "full",
      world: "true",
      verification: "true",
      packaging: "true",
    });
    expect(JSON.parse(fields.selection!).full).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("metadata can reuse a passing scoped merge only with the identical selection", async () => {
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
        validation: { mode: "scoped", selection: recorded },
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
});
