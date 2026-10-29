import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { listWorktrees, pruneWorktree } from "../worktree.mjs";
import { checkoutOf } from "./review";
import type { Deps } from "./deps";
import {
  activeRuns,
  chatTabsForPr,
  closeRound,
  deleteMeta,
  finishRun,
  getMeta,
  openRounds,
  roundTabs,
  runsOf,
  setMeta,
  trackedPrs,
} from "./store";
import type { Database } from "bun:sqlite";
import type { GateInput, Verdict } from "../gate/predicate";
import { latestInput } from "../gate/store";

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
  lookupTracked?: (prs: number[]) => {
    inputs: GateInput[];
    failures: Map<number, string>;
  },
  out: (line: string) => void = () => {},
) {
  const terminal = new Map<number, GateInput>();
  const confirmedOpen = new Map<number, GateInput>();
  const observed = new Set(verdicts.map((verdict) => verdict.number));
  const tracked = new Set(trackedPrs(crew));
  const cleanupKey = (pr: number) => `terminal-cleanup:${pr}`;
  const branchKey = (pr: number) => `terminal-branch:${pr}`;
  for (const input of inputs)
    if (input.state === "OPEN") {
      deleteMeta(crew, cleanupKey(input.number));
      if (tracked.has(input.number)) {
        deleteMeta(crew, branchKey(input.number));
        if (input.item?.branch)
          setMeta(crew, branchKey(input.number), input.item.branch);
      }
    }
  for (const verdict of verdicts)
    if (
      (verdict.state === "MERGED" || verdict.state === "CLOSED") &&
      tracked.has(verdict.number) &&
      getMeta(crew, cleanupKey(verdict.number)) !== "done"
    ) {
      const input = inputs.find((entry) => entry.number === verdict.number);
      if (input) terminal.set(verdict.number, input);
    }
  // Gate history may be advanced by standalone gate passes or dry runs. Query
  // each tracked PR by number to confirm an omission is terminal before acting.
  if (!prs.length) {
    const candidates = [...tracked].filter(
      (pr) => !observed.has(pr) && getMeta(crew, cleanupKey(pr)) !== "done",
    );
    const previous = new Map(
      candidates.map((pr) => [pr, gate ? latestInput(gate, pr) : null]),
    );
    for (const [pr, input] of previous)
      if (input?.item?.branch) setMeta(crew, branchKey(pr), input.item.branch);
    let lookedUp: { inputs: GateInput[]; failures: Map<number, string> } = {
      inputs: [],
      failures: new Map(),
    };
    if (lookupTracked && candidates.length) {
      try {
        lookedUp = lookupTracked(candidates);
      } catch {
        for (const pr of candidates)
          try {
            const result = lookupTracked([pr]);
            lookedUp.inputs.push(...result.inputs);
            for (const [failedPr, error] of result.failures)
              lookedUp.failures.set(failedPr, error);
          } catch (error) {
            lookedUp.failures.set(
              pr,
              error instanceof Error ? error.message : String(error),
            );
          }
      }
    }
    for (const [pr, error] of lookedUp.failures)
      out(`#${pr} couldn't confirm pull request state; retrying: ${error}`);
    for (const latest of lookedUp.inputs) {
      if (latest.state === "OPEN") {
        confirmedOpen.set(latest.number, latest);
        deleteMeta(crew, cleanupKey(latest.number));
        deleteMeta(crew, branchKey(latest.number));
        if (latest.item?.branch)
          setMeta(crew, branchKey(latest.number), latest.item.branch);
      }
      if (latest.state !== "MERGED" && latest.state !== "CLOSED") continue;
      const prior = previous.get(latest.number);
      const branch =
        latest.item?.branch ??
        prior?.item?.branch ??
        getMeta(crew, branchKey(latest.number)) ??
        undefined;
      terminal.set(
        latest.number,
        branch && !latest.item
          ? {
              ...latest,
              item: { ...prior?.item, branch } as NonNullable<
                GateInput["item"]
              >,
            }
          : latest,
      );
    }
  }
  for (const pr of terminal.keys()) setMeta(crew, cleanupKey(pr), "pending");
  return { terminal, confirmedOpen };
}

/** Finish cleanup for terminal PRs; failed reviewer cleanup is retried. */
export function cleanupTerminalPrs(
  crew: Database,
  dir: string,
  now: number,
  deps: Deps,
  terminal: Map<number, GateInput>,
  out: (line: string) => void,
  options: {
    cleanupAuthor?: typeof cleanupAuthorWorktree;
    refreshMain?: (repo: string) => void;
  } = {},
) {
  const repo = dirname(dirname(dir));
  let refreshAttempted = false;
  let refreshError: unknown;
  const refreshMain = () => {
    if (!refreshAttempted) {
      refreshAttempted = true;
      try {
        (options.refreshMain ?? refreshOriginMain)(repo);
      } catch (error) {
        refreshError = error;
      }
    }
    if (refreshError) throw refreshError;
  };
  for (const [pr, input] of terminal) {
    const key = `terminal-cleanup:${pr}`;
    if (!cleanupTerminalReviewers(crew, dir, pr, now, deps, out)) {
      setMeta(crew, key, "pending");
      continue;
    }
    const authorCleaned = (options.cleanupAuthor ?? cleanupAuthorWorktree)(
      repo,
      pr,
      input.item?.branch,
      out,
      { refreshMain },
    );
    if (authorCleaned === false) setMeta(crew, key, "pending");
    else {
      setMeta(crew, key, "done");
      deleteMeta(crew, `terminal-branch:${pr}`);
    }
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
  for (const tab of chatTabsForPr(crew, pr)) tabs.add(tab);
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
    const pid = runsOf(crew, pr).find((entry) => entry.id === run.id)?.pid;
    if (pid) deps.kill(pid);
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
): boolean {
  if (!branch) {
    out(
      `#${pr} couldn't identify the author branch; leaving its worktree alone`,
    );
    return true;
  }
  if (!options.worktrees && !existsSync(join(repo, ".git"))) return true;
  const ref = `refs/heads/${branch.replace(/^refs\/heads\//u, "")}`;
  let worktrees: Worktree[];
  try {
    worktrees = options.worktrees ?? listWorktrees(repo);
  } catch {
    out(
      `#${pr} couldn't inspect worktrees safely; leaving the author checkout alone`,
    );
    return true;
  }
  const worktree = worktrees.find((entry) => entry.branch === ref);
  if (!worktree) return true;

  try {
    (options.refreshMain ?? refreshOriginMain)(repo);
  } catch {
    out(
      `#${pr} kept author worktree for ${branch}: couldn't refresh origin/main`,
    );
    return false;
  }

  let result: ReturnType<Prune>;
  try {
    result = (options.prune ?? pruneWorktree)(worktree.path, { cwd: repo });
  } catch {
    out(`#${pr} couldn't assess the author worktree safely; leaving it alone`);
    return true;
  }
  if (result.action === "remove")
    out(`#${pr} removed author worktree for ${branch}: ${result.reason}`);
  else if (result.action === "strip")
    out(
      `#${pr} stripped build output from author worktree for ${branch}: ${result.reason}`,
    );
  else out(`#${pr} kept author worktree for ${branch}: ${result.reason}`);
  return true;
}

function refreshOriginMain(repo: string) {
  execFileSync("git", ["-C", repo, "fetch", "--quiet", "origin", "main"], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 15_000,
  });
}
