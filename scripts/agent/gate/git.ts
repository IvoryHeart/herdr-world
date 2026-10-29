import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CopyResult } from "./predicate";

/**
 * A private bare mirror holds pull request heads and main, so the gate never
 * fetches into a checkout or another agent's worktree. The copy rule follows
 * Gerrit's: a reviewer's claim survives only commits that merge main cleanly.
 */

export type GitResult = { code: number; stdout: string; stderr: string };

export function git(dir: string, args: string[]): GitResult {
  const result = Bun.spawnSync(["git", "--git-dir", dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export function ensureMirror(dir: string) {
  if (existsSync(dir)) return;
  mkdirSync(dirname(dir), { recursive: true });
  const result = Bun.spawnSync(["git", "init", "--quiet", "--bare", dir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Can't create the gate's git mirror: ${result.stderr.toString().trim()}`,
    );
}

/** Main and every listed pull request head, in one fetch. */
export function fetchPulls(dir: string, remote: string, numbers: number[]) {
  const refspecs = [
    "+refs/heads/main:refs/heads/main",
    ...numbers.map((number) => `+refs/pull/${number}/head:refs/pull/${number}`),
  ];
  const result = git(dir, [
    "fetch",
    "--quiet",
    "--no-tags",
    remote,
    ...refspecs,
  ]);
  if (result.code !== 0)
    throw new Error(`Git fetch failed: ${result.stderr.trim().slice(0, 300)}`);
}

/** A reviewed commit force-pushed off its branch; absence stays unknown. */
export function fetchCommit(dir: string, remote: string, sha: string) {
  if (hasCommit(dir, sha)) return true;
  git(dir, ["fetch", "--quiet", "--no-tags", remote, sha]);
  return hasCommit(dir, sha);
}

function hasCommit(dir: string, sha: string) {
  return git(dir, ["cat-file", "-e", `${sha}^{commit}`]).code === 0;
}

const isAncestor = (dir: string, ancestor: string, descendant: string) =>
  git(dir, ["merge-base", "--is-ancestor", ancestor, descendant]).code === 0;

/**
 * Whether a claim on `reviewed` counts for `head`: every commit on the
 * first-parent path from `reviewed` to `head` must merge a commit already on
 * main, and replaying that merge must give its exact tree without conflict.
 * Anything else, including a resolved conflict, is new code to review.
 */
export function copyRule(
  dir: string,
  reviewed: string,
  head: string,
  main = "refs/heads/main",
): CopyResult {
  if (reviewed === head) return { kind: "same" };
  for (const sha of [reviewed, head])
    if (!hasCommit(dir, sha))
      return { kind: "unknown", detail: `${sha.slice(0, 7)} not available` };
  if (!isAncestor(dir, reviewed, head))
    return { kind: "outdated", detail: "history rewritten since" };
  const path = git(dir, [
    "rev-list",
    "--first-parent",
    "--parents",
    "--reverse",
    `${reviewed}..${head}`,
  ]);
  if (path.code !== 0) return { kind: "unknown", detail: "can't walk history" };
  let previous = reviewed;
  for (const line of path.stdout.trim().split("\n")) {
    const [commit, ...parents] = line.split(" ");
    const short = commit!.slice(0, 7);
    if (parents[0] !== previous)
      return {
        kind: "outdated",
        detail: `${short} is not on the reviewed line`,
      };
    if (parents.length !== 2)
      return { kind: "outdated", detail: `${short} is not a merge of main` };
    if (!isAncestor(dir, parents[1]!, main))
      return {
        kind: "outdated",
        detail: `${short} merges a commit not on main`,
      };
    const replay = git(dir, [
      "merge-tree",
      "--write-tree",
      parents[0]!,
      parents[1]!,
    ]);
    if (replay.code === 1)
      return { kind: "conflict", detail: `${short} resolved a conflict` };
    if (replay.code !== 0)
      return { kind: "unknown", detail: `can't replay ${short}` };
    const tree = git(dir, ["rev-parse", `${commit}^{tree}`]).stdout.trim();
    if (replay.stdout.split("\n")[0]!.trim() !== tree)
      return {
        kind: "conflict",
        detail: `${short} changes more than the merge`,
      };
    previous = commit!;
  }
  return { kind: "clean-merge" };
}

/** Files both the pull request and main changed since they diverged. */
export function overlap(
  dir: string,
  head: string,
  main = "refs/heads/main",
): string[] | null {
  const base = git(dir, ["merge-base", head, main]);
  if (base.code !== 0) return null;
  const files = (to: string) => {
    const result = git(dir, ["diff", "--name-only", base.stdout.trim(), to]);
    return result.code === 0 ? result.stdout.split("\n").filter(Boolean) : null;
  };
  const ours = files(head);
  const theirs = files(main);
  if (!ours || !theirs) return null;
  const changed = new Set(theirs);
  return ours.filter((file) => changed.has(file));
}
