import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { listWorktrees, pruneWorktree } from "../worktree.mjs";
import { checkoutOf } from "./review";
import type { Deps } from "./deps";
import {
  activeRuns,
  closeRound,
  finishRun,
  openRounds,
  roundTabs,
  runsOf,
} from "./store";
import type { Database } from "bun:sqlite";

type Worktree = ReturnType<typeof listWorktrees>[number];
type Prune = (
  path: string,
  options: { cwd: string },
) => { action: string; reason: string };

/** Close every reviewer tab and remove its sessions and checkouts for a terminal PR. */
export function cleanupTerminalReviewers(
  crew: Database,
  dir: string,
  pr: number,
  now: number,
  deps: Deps,
  out: (line: string) => void,
) {
  const runs = runsOf(crew, pr).toSorted(
    (a, b) => (a.round ?? 0) - (b.round ?? 0) || a.id - b.id,
  );
  const tabs = new Set(runs.flatMap((run) => (run.tab ? [run.tab] : [])));
  for (const run of runs)
    if (run.round !== null)
      for (const tab of roundTabs(crew, pr, run.round)) tabs.add(tab);
  for (const round of openRounds(crew).filter((entry) => entry.pr === pr))
    if (round.tab) tabs.add(round.tab);

  let done = true;
  for (const tab of tabs) done = deps.closeTab(tab) && done;
  if (!done) {
    out(`#${pr} couldn't close reviewer tabs yet; retrying`);
    return false;
  }

  for (const run of activeRuns(crew).filter((entry) => entry.pr === pr)) {
    finishRun(crew, run.id, -15, null, now);
    if (run.pid) deps.kill(run.pid);
  }
  for (const run of runs) {
    const checkout = checkoutOf(dir, run);
    if (!existsSync(checkout)) continue;
    const removed = deps.run([
      "git",
      "-C",
      dirname(dirname(dir)),
      "worktree",
      "remove",
      "--force",
      checkout,
    ]);
    if (removed.code !== 0 && existsSync(checkout)) done = false;
  }
  if (!done) {
    out(`#${pr} couldn't remove every reviewer checkout yet; retrying`);
    return false;
  }

  for (const round of openRounds(crew).filter((entry) => entry.pr === pr))
    closeRound(crew, pr, round.round, now);
  if (runs.length || tabs.size)
    out(`#${pr} closed reviewer sessions and checkouts`);
  return true;
}

/** Remove the author's branch checkout only when normal prune accepts it. */
export function cleanupAuthorWorktree(
  repo: string,
  pr: number,
  branch: string | undefined,
  out: (line: string) => void,
  options: {
    worktrees?: Worktree[];
    prune?: Prune;
    refreshMain?: (repo: string) => void;
  } = {},
) {
  if (!branch) {
    out(
      `#${pr} couldn't identify the author branch; leaving its worktree alone`,
    );
    return;
  }
  if (!options.worktrees && !existsSync(join(repo, ".git"))) return;
  const ref = `refs/heads/${branch.replace(/^refs\/heads\//u, "")}`;
  let worktrees: Worktree[];
  try {
    worktrees = options.worktrees ?? listWorktrees(repo);
  } catch {
    out(
      `#${pr} couldn't inspect worktrees safely; leaving the author checkout alone`,
    );
    return;
  }
  const worktree = worktrees.find((entry) => entry.branch === ref);
  if (!worktree) return;

  try {
    (options.refreshMain ?? refreshOriginMain)(repo);
  } catch {
    out(
      `#${pr} kept author worktree for ${branch}: couldn't refresh origin/main`,
    );
    return;
  }

  let result: ReturnType<Prune>;
  try {
    result = (options.prune ?? pruneWorktree)(worktree.path, { cwd: repo });
  } catch {
    out(`#${pr} couldn't assess the author worktree safely; leaving it alone`);
    return;
  }
  if (result.action === "remove")
    out(`#${pr} removed author worktree for ${branch}: ${result.reason}`);
  else out(`#${pr} kept author worktree for ${branch}: ${result.reason}`);
}

function refreshOriginMain(repo: string) {
  execFileSync("git", ["-C", repo, "fetch", "--quiet", "origin", "main"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}
