import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyRule,
  ensureMirror,
  fetchCommit,
  fetchPulls,
  overlap,
} from "./git";

let root: string;
let work: string;
const gitDir = () => join(work, ".git");

function sh(...args: string[]) {
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=Example",
      "-c",
      "user.email=dev@example.com",
      ...args,
    ],
    { cwd: work, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString().trim();
}

function commit(file: string, text: string, message: string) {
  writeFileSync(join(work, file), text);
  sh("add", file);
  sh("commit", "--quiet", "-m", message);
  return sh("rev-parse", "HEAD");
}

const lines = (count: number, change?: [number, string]) =>
  Array.from({ length: count }, (_, index) =>
    change && change[0] === index ? change[1] : `line ${index}`,
  ).join("\n");

// main:   base ── mainB (b.txt) ── mainA (a.txt line 9)
// pr:     base ── reviewed (a.txt line 1)
let base: string;
let reviewed: string;
let mainB: string;
let mainA: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "agent-gate-git-"));
  work = join(root, "work");
  Bun.spawnSync(["git", "init", "--quiet", "-b", "main", work]);
  writeFileSync(join(work, "b.txt"), "b\n");
  sh("add", "b.txt");
  base = commit("a.txt", lines(10), "base");
  sh("checkout", "--quiet", "-b", "pr");
  reviewed = commit("a.txt", lines(10, [1, "pr change"]), "pr change");
  sh("checkout", "--quiet", "main");
  mainB = commit("b.txt", "b changed\n", "main changes b");
  mainA = commit(
    "a.txt",
    lines(10, [9, "main change"]),
    "main changes a far away",
  );
  sh("checkout", "--quiet", "pr");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Each scenario starts clean on the reviewed commit, whatever came before. */
function onPr(steps: () => string) {
  Bun.spawnSync(["git", "merge", "--abort"], { cwd: work, stderr: "pipe" });
  sh("reset", "--quiet", "--hard");
  sh("checkout", "--quiet", "-B", "scratch", reviewed);
  return steps();
}

describe("copy rule", () => {
  test("the same commit counts", () => {
    expect(copyRule(gitDir(), reviewed, reviewed).kind).toBe("same");
  });

  test("a clean merge of main carries the claim", () => {
    const head = onPr(() => {
      sh("merge", "--quiet", "--no-edit", mainB);
      return sh("rev-parse", "HEAD");
    });
    expect(copyRule(gitDir(), reviewed, head)).toEqual({ kind: "clean-merge" });
  });

  test("two clean main merges in a row still carry the claim", () => {
    const head = onPr(() => {
      sh("merge", "--quiet", "--no-edit", mainB);
      sh("merge", "--quiet", "--no-edit", mainA);
      return sh("rev-parse", "HEAD");
    });
    expect(copyRule(gitDir(), reviewed, head).kind).toBe("clean-merge");
  });

  test("a resolved conflict needs confirmation", () => {
    const conflicting = (() => {
      sh("checkout", "--quiet", "-B", "main-conflict", mainB);
      const sha = commit(
        "a.txt",
        lines(10, [1, "main also changed line 1"]),
        "conflict",
      );
      sh("branch", "-f", "main", sha);
      return sha;
    })();
    const head = onPr(() => {
      // Conflicts make this merge exit non-zero; the resolution follows.
      const merge = Bun.spawnSync(
        [
          "git",
          "-c",
          "user.name=Example",
          "-c",
          "user.email=dev@example.com",
          "merge",
          "--no-edit",
          conflicting,
        ],
        { cwd: work, stdout: "pipe", stderr: "pipe" },
      );
      expect(merge.stdout.toString()).toContain("CONFLICT");
      writeFileSync(join(work, "a.txt"), lines(10, [1, "resolved"]));
      sh("add", "a.txt");
      sh("commit", "--quiet", "-m", "merge main");
      return sh("rev-parse", "HEAD");
    });
    expect(copyRule(gitDir(), reviewed, head).kind).toBe("conflict");
    sh("branch", "-f", "main", mainA);
  });

  test("a merge that also changes code needs confirmation", () => {
    const head = onPr(() => {
      sh("merge", "--quiet", "--no-edit", "--no-commit", mainB);
      writeFileSync(join(work, "a.txt"), lines(10, [5, "slipped in"]));
      sh("add", "a.txt");
      sh("commit", "--quiet", "-m", "merge main");
      return sh("rev-parse", "HEAD");
    });
    expect(copyRule(gitDir(), reviewed, head)).toMatchObject({
      kind: "conflict",
    });
  });

  test("a new ordinary commit makes the claim outdated", () => {
    const head = onPr(() => commit("a.txt", lines(10, [2, "fix"]), "fix"));
    expect(copyRule(gitDir(), reviewed, head)).toMatchObject({
      kind: "outdated",
    });
  });

  test("a clean merge followed by an ordinary commit is outdated", () => {
    const head = onPr(() => {
      sh("merge", "--quiet", "--no-edit", mainB);
      return commit("a.txt", lines(10, [3, "after merge"]), "after merge");
    });
    expect(copyRule(gitDir(), reviewed, head).kind).toBe("outdated");
  });

  test("merging a branch that is not on main is outdated", () => {
    const side = (() => {
      sh("checkout", "--quiet", "-B", "side", base);
      return commit("c.txt", "side\n", "side work");
    })();
    const head = onPr(() => {
      sh("merge", "--quiet", "--no-edit", side);
      return sh("rev-parse", "HEAD");
    });
    expect(copyRule(gitDir(), reviewed, head)).toMatchObject({
      kind: "outdated",
    });
  });

  test("rewritten history is outdated", () => {
    const head = (() => {
      sh("checkout", "--quiet", "-B", "rewritten", base);
      return commit("a.txt", lines(10, [1, "rewritten"]), "rewritten");
    })();
    expect(copyRule(gitDir(), reviewed, head)).toMatchObject({
      kind: "outdated",
    });
  });

  test("a missing commit is unknown", () => {
    expect(copyRule(gitDir(), "e".repeat(40), reviewed).kind).toBe("unknown");
  });
});

test("overlap lists files both sides changed since they diverged", () => {
  expect(overlap(gitDir(), reviewed, "refs/heads/main")).toEqual(["a.txt"]);
  const onlyB = onPr(() => sh("rev-parse", "HEAD"));
  sh("branch", "-f", "main", mainB);
  expect(overlap(gitDir(), onlyB, "refs/heads/main")).toEqual([]);
  sh("branch", "-f", "main", mainA);
});

test("the private mirror fetches main and pull request heads from a remote", () => {
  const remote = join(root, "remote.git");
  Bun.spawnSync(["git", "init", "--quiet", "--bare", remote]);
  sh(
    "push",
    "--quiet",
    remote,
    `${mainA}:refs/heads/main`,
    `${reviewed}:refs/pull/7/head`,
  );
  const mirror = join(root, "gate", "mirror.git");
  ensureMirror(mirror);
  ensureMirror(mirror);
  fetchPulls(mirror, remote, [7]);
  expect(copyRule(mirror, reviewed, reviewed).kind).toBe("same");
  expect(overlap(mirror, reviewed)).toEqual(["a.txt"]);
  expect(fetchCommit(mirror, remote, reviewed)).toBe(true);
  expect(fetchCommit(mirror, remote, "f".repeat(40))).toBe(false);
  expect(() => fetchPulls(mirror, join(root, "missing.git"), [7])).toThrow(
    "Git fetch failed",
  );
});
