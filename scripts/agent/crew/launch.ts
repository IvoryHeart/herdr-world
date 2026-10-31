import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { shortSha } from "../../../shared/pullRequests";
import type { Deps } from "./deps";
import {
  addRun,
  roundFor,
  roundPanes,
  setAction,
  setRoundTab,
  setRunPane,
  setRunPid,
  type Round,
} from "./store";

/** A round tab's name for a PR: its number and its branch's short name. */
export function roundLabel(
  pr: number,
  branch: string | undefined,
  round: number,
) {
  const name = branch?.split("/").slice(1).join("/") || branch;
  return `#${pr}${name ? ` ${name}` : ""} · r${round}`;
}

/**
 * Starts one fresh run for `keys`, the steps it takes on: a reviewer, or a
 * fixer working in its PR's worktree (`cwd`). It joins the PR head's round
 * tab, beside the round's newest pane. The run row and the steps' running
 * state are committed before the launch, so a crash still counts the run.
 */
export function launchRun(
  crew: Database,
  context: { dir: string; now: number; deps: Deps },
  run: {
    keys: string[];
    pr: number;
    head: string;
    /** The pane's name and the run's: the reviewer, or the author seat. */
    name: string;
    cwd?: string;
    branch: string | undefined;
    /** Evaluator/process seats join the triggering review's existing tab. */
    round?: Round;
  },
  argv: (id: number) => string[],
) {
  const { dir, now, deps } = context;
  const { pr, head } = run;
  const log = join(
    dir,
    "runs",
    `${pr}-${run.name}${run.cwd ? "-fixer" : ""}-${shortSha(head)}-${now}.log`,
  );
  const round = run.round ?? roundFor(crew, pr, head, now);
  const panes = roundPanes(crew, pr, round.round);
  const id = addRun(
    crew,
    {
      actionKey: run.keys[0]!,
      reviewer: run.name,
      pr,
      head,
      log,
      round: round.round,
      ...(run.cwd ? { cwd: run.cwd } : {}),
    },
    now,
  );
  for (const key of run.keys)
    setAction(crew, key, "running", now, `run ${id}`, true);
  Bun.write(log, "");
  const label = roundLabel(pr, run.branch, round.round);
  const started = deps.spawn(argv(id), log, {
    tab: round.tab,
    after: panes.at(-1) ?? null,
    direction: panes.length % 2 ? "right" : "down",
    label,
    title: run.cwd ? `${run.name} fixer` : run.name,
  });
  if (started.pid !== null) setRunPid(crew, id, started.pid);
  if (started.pane) setRunPane(crew, id, started.pane, started.tab);
  if (started.tab && started.tab !== round.tab)
    setRoundTab(crew, pr, round.round, started.tab);
  return {
    id,
    log,
    where: `run ${id}${started.pane ? `, Herdr tab "${label}"` : ""}, log ${log}`,
  };
}
