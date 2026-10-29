import type { RoundContext } from "./round-policy";
import {
  type ReviewCycle,
  reviewCycles,
  saveCycle,
} from "./round-policy-store";
import { actionsIn, getAction, openRounds, roundFor, runsOf } from "./store";
import type { Action } from "./plan";

/** Upgrade old stores from real reviewer runs, excluding fixer/auxiliary runs. */
export function adoptCycles(context: RoundContext) {
  const { crew, input, now, dryRun } = context;
  let cycles = reviewCycles(crew, input.number);
  if (cycles.length) return cycles;
  const runs = runsOf(crew, input.number);
  const actions = actionsIn(crew, [
    "pending",
    "running",
    "sent",
    "done",
    "failed",
  ]);
  for (const round of openRounds(crew).filter(
    (round) => round.pr === input.number,
  )) {
    const assigned = actions.filter(
      (action) =>
        action.pr === input.number &&
        action.head === round.head &&
        ["review", "confirm"].includes(action.kind),
    );
    const started = runs.filter(
      (run) =>
        run.round === round.round &&
        !run.cwd &&
        ["review", "confirm"].includes(
          getAction(crew, run.actionKey)?.kind ?? "review",
        ),
    );
    if (!started.length && !assigned.length) continue;
    const reviewers = [
      ...new Set([
        ...started.map((run) => run.reviewer),
        ...assigned.map((action) => action.target),
        ...context.requiredReviewers,
      ]),
    ];
    if (!reviewers.length) continue;
    const cycle: ReviewCycle = {
      pr: input.number,
      round: round.round,
      ordinal: cycles.length + 1,
      head: round.head,
      ...(cycles.length ? { since: cycles.at(-1)!.head } : {}),
      reviewers,
      reviewActions: reviewers.map((target): Action => {
        const original = assigned.find((action) => action.target === target);
        if (original) {
          const { key, pr, head, kind, text, since } = original;
          return {
            key,
            pr,
            head,
            kind,
            target,
            text,
            ...(since ? { since } : {}),
          };
        }
        return {
          pr: input.number,
          head: round.head,
          kind: "review",
          target,
          key: `${input.number}:${round.head}:review:${target}`,
          text: `${target} reviews #${input.number} in full`,
        };
      }),
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
