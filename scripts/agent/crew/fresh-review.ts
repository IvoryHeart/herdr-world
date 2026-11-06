import type { RoundContext } from "./round-policy";
import { saveCycle } from "./round-policy-store";
import { roundFor } from "./store";
import type { Action } from "./plan";
import { harnessOf } from "./worker";

/** Old posts remain history; a new admission starts with a complete current review. */
export function freshReview(context: RoundContext): Action[] {
  const { input, now, crew, dryRun } = context;
  const head = input.item!.headSha!;
  const reviewers = context.requiredReviewers;
  const missing = reviewers.filter(
    (r) =>
      !context.settings.roster[r] || !harnessOf(context.settings.roster[r]!),
  );
  if (missing.length)
    return [
      {
        pr: input.number,
        head,
        kind: "judgment",
        target: "owner",
        key: `${input.number}:${head}:judgment:owner:fresh-review-profile`,
        text: `NEEDS-OWNER #${input.number}: required reviewer profiles unavailable: ${missing.join(", ")}; no review admitted.`,
      },
    ];
  const actions: Action[] = reviewers.map((target) => ({
    pr: input.number,
    head,
    target,
    kind: "review",
    key: `${input.number}:${head}:review:${target}:fresh-${now}:round-1`,
    text: `${target} reviews #${input.number} in full at ${head.slice(0, 7)}`,
  }));
  if (!reviewers.length) return [];
  if (!dryRun) {
    const round = roundFor(crew, input.number, head, now);
    saveCycle(crew, {
      pr: input.number,
      head,
      round: round.round,
      ordinal: 1,
      reviewers,
      freshStart: now,
      reviewActions: actions,
      ignoredSources: input.history.map((claim) => claim.url),
      trigger: {
        replies: [],
        quietSince: now,
        reason: "first full crew review; earlier posts are history",
      },
    });
  }
  return actions;
}
