import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { listWorktrees, pruneWorktree } from "../worktree.mjs";
import { checkoutOf } from "./review";
import type { Deps } from "./deps";
import {
  activeRuns,
  closeRound,
  deleteMeta,
  finishRun,
  getMeta,
  metaWithPrefix,
  openRounds,
  roundTabs,
  runsOf,
  setMeta,
  trackedPrs,
} from "./store";
import type { Database } from "bun:sqlite";
import type { GateInput, Verdict } from "../gate/predicate";
import { latestInput, previousOpenPassInputs } from "../gate/store";

type Worktree = ReturnType<typeof listWorktrees>[number];
type Prune = (
  path: string,
  options: { cwd: string },
) => { action: string; reason: string };

/** PRs whose tracked reviewer state needs terminal cleanup on this pass. */
export function terminalInputs(
  crew: Database,
  gate: Database | undefined,
  prs: number[],
  inputs: GateInput[],
  verdicts: Verdict[],
  rounds: { pr: number }[],
) {
  const terminal = new Map<number, GateInput>();
  const observed = new Set(verdicts.map((verdict) => verdict.number));
  const tracked = new Set(trackedPrs(crew));
  const cleanupKey = (pr: number) => `terminal-cleanup:${pr}`;
  for (const input of inputs)
    if (input.state === "OPEN") deleteMeta(crew, cleanupKey(input.number));
  for (const verdict of verdicts)
    if (
      (verdict.state === "MERGED" || verdict.state === "CLOSED") &&
      tracked.has(verdict.number) &&
      getMeta(crew, cleanupKey(verdict.number)) !== "done"
    ) {
      const input = inputs.find((entry) => entry.number === verdict.number);
      if (input) terminal.set(verdict.number, input);
    }
  // A full pass reads the complete open-PR list. A previously open PR missing
  // from that list has merged or closed; scoped passes cannot infer it.
  if (!prs.length) {
    const previous = new Map<number, GateInput>();
    for (const input of gate ? previousOpenPassInputs(gate) : [])
      previous.set(input.number, input);
    for (const round of rounds) {
      const input = gate
        ? latestInput(gate, round.pr)
        : inputs.find((entry) => entry.number === round.pr);
      if (input) previous.set(round.pr, input);
    }
    for (const [pr, input] of previous)
      if (
        tracked.has(pr) &&
        !observed.has(pr) &&
        getMeta(crew, cleanupKey(pr)) !== "done"
      ) {
        const latest = gate ? latestInput(gate, pr) : input;
        if (latest) terminal.set(pr, latest);
      }
    for (const { key, value } of metaWithPrefix(crew, "terminal-cleanup:")) {
      if (value !== "pending") continue;
      const pr = Number(key.slice("terminal-cleanup:".length));
      const input = gate ? latestInput(gate, pr) : null;
      if (input && !observed.has(pr)) terminal.set(pr, input);
    }
  }
  return terminal;
}

/** Finish cleanup for terminal PRs; failed reviewer cleanup is retried. */
export function cleanupTerminalPrs(
  crew: Database,
  dir: string,
  now: number,
  deps: Deps,
  terminal: Map<number, GateInput>,
  out: (line: string) => void,
) {
  for (const [pr, input] of terminal) {
    const key = `terminal-cleanup:${pr}`;
    if (!cleanupTerminalReviewers(crew, dir, pr, now, deps, out)) {
      setMeta(crew, key, "pending");
      continue;
    }
    cleanupAuthorWorktree(dirname(dirname(dir)), pr, input.item?.branch, out);
    setMeta(crew, key, "done");
  }
}

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
