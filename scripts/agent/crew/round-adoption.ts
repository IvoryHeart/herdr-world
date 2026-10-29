import type { RoundContext } from "./round-policy";
import {
  type ReviewCycle,
  reviewCycles,
  saveCycle,
} from "./round-policy-store";
import { getAction, openRounds, roundFor, runsOf } from "./store";

/** Upgrade old stores from real reviewer runs, excluding fixer/auxiliary runs. */
export function adoptCycles(context: RoundContext) {
  const { crew, input, now, dryRun } = context;
  let cycles = reviewCycles(crew, input.number);
  if (cycles.length) return cycles;
  const runs = runsOf(crew, input.number);
  for (const round of openRounds(crew).filter(
    (round) => round.pr === input.number,
  )) {
    const reviewers = [
      ...new Set(
        runs
          .filter(
            (run) =>
              run.round === round.round &&
              !run.cwd &&
              ["review", "confirm"].includes(
                getAction(crew, run.actionKey)?.kind ?? "review",
              ),
          )
          .map((run) => run.reviewer),
      ),
    ];
    if (!reviewers.length) continue;
    const cycle: ReviewCycle = {
      pr: input.number,
      round: round.round,
      ordinal: cycles.length + 1,
      head: round.head,
      ...(cycles.length ? { since: cycles.at(-1)!.head } : {}),
      reviewers,
      trigger: {
        replies: [],
        quietSince: now,
        reason: "adopted existing reviewer round",
      },
    };
    cycles = [...cycles, cycle];
    if (!dryRun) saveCycle(crew, cycle);
  }
  if (
    !cycles.length &&
    !context.actions.some((action) =>
      ["review", "confirm"].includes(action.kind),
    )
  ) {
    const commits = [
      ...new Set(
        input.history.flatMap((claim) => (claim.commit ? [claim.commit] : [])),
      ),
    ];
    for (const head of commits) {
      if (
        !context.requiredReviewers.length ||
        !context.requiredReviewers.every((name) =>
          input.history.some(
            (claim) => claim.reviewer === name && claim.commit === head,
          ),
        )
      )
        continue;
      const round = dryRun
        ? { round: cycles.length + 1 }
        : roundFor(crew, input.number, head, now);
      const cycle: ReviewCycle = {
        pr: input.number,
        head,
        round: round.round,
        ordinal: cycles.length + 1,
        reviewers: context.requiredReviewers,
        ...(cycles.length ? { since: cycles.at(-1)!.head } : {}),
        trigger: {
          replies: [],
          quietSince: now,
          reason: "adopted existing GitHub reviews",
        },
      };
      cycles.push(cycle);
      if (!dryRun) saveCycle(crew, cycle);
    }
  }
  return cycles;
}
