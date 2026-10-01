import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canReuseFullCheck, isDocsOnlyChange } from "./ci-reuse-full-check";

const base = "a".repeat(40);
const head = "b".repeat(40);
const pr = { number: 126, base: { sha: base }, head: { sha: head } };
const run = (id: number, baseSha = base) => ({
  id,
  head_sha: head,
  pull_requests: [{ ...pr, base: { sha: baseSha } }],
});
const job = (full: string, result = "success", reused = false) => ({
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
  jobs: Record<number, ReturnType<typeof job>[]>,
) =>
  canReuseFullCheck(
    runs,
    4,
    126,
    base,
    head,
    "Delivery checks",
    "Run full repository check",
    async (id) => jobs[id] ?? [],
  );

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
