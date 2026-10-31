import type { Database } from "bun:sqlite";
import type { Deps } from "./deps";
import { launchRun } from "./launch";
import type { CrewSettings } from "./plan";
import { FRESH_KINDS } from "./round-policy";
import { evaluations, reviewCycles } from "./round-policy-store";
import { activeRuns, openRounds, type StoredAction } from "./store";

export function startReviewers(
  crew: Database,
  context: { now: number; dir: string; deps: Deps; worker: string[] },
  settings: CrewSettings,
  pending: StoredAction[],
  authors: Map<number, { author: string | null; branch: string | undefined }>,
  say: (text: string) => void,
) {
  let slots = settings.maxRuns - activeRuns(crew).length;
  for (const entry of pending) {
    if (!FRESH_KINDS.has(entry.kind) || slots <= 0) continue;
    const item = authors.get(entry.pr);
    const evaluation =
      entry.kind === "evaluate" || entry.kind === "process"
        ? evaluations(crew, entry.pr).at(-1)
        : undefined;
    const cycle = reviewCycles(crew, entry.pr).findLast(
      (cycle) => cycle.head === entry.head,
    );
    const roundNumber = evaluation?.round ?? cycle?.round;
    const round = openRounds(crew).find(
      (round) => round.pr === entry.pr && round.round === roundNumber,
    );
    const run = launchRun(
      crew,
      context,
      {
        keys: [entry.key],
        pr: entry.pr,
        head: entry.head,
        name: entry.target,
        branch: item?.branch,
        ...(round ? { round } : {}),
      },
      (id) => [
        ...context.worker,
        entry.kind === "evaluate"
          ? "evaluate"
          : entry.kind === "process"
            ? "process"
            : "review",
        "--pr",
        String(entry.pr),
        "--reviewer",
        entry.target,
        "--head",
        entry.head,
        "--run",
        String(id),
        ...(entry.since ? ["--since", entry.since] : []),
        ...(item?.author ? ["--author", item.author] : []),
        ...(evaluation ? ["--evaluation", String(evaluation.checkpoint)] : []),
      ],
    );
    say(`#${entry.pr} started ${entry.target} ${entry.kind} (${run.where})`);
    slots--;
  }
}
