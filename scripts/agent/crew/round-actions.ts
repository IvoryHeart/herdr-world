import type { Database } from "bun:sqlite";
import type { GateInput } from "../gate/predicate";
import type { Action } from "./plan";
import { type ReviewCycle, reviewCycles } from "./round-policy-store";

export const REVIEW_KINDS = new Set(["review", "confirm"]);
export const FRESH_KINDS = new Set([
  "review",
  "confirm",
  "evaluate",
  "process",
]);

export function completed(input: GateInput, cycle: ReviewCycle) {
  const claims = cycle.reviewers.map((name) =>
    input.history.findLast(
      (claim) =>
        claim.reviewer === name &&
        claim.commit === cycle.head &&
        !cycle.ignoredSources?.includes(claim.url),
    ),
  );
  return claims.every((claim) => claim && claim.outcome !== "unknown")
    ? claims
    : null;
}

export function outstanding(input: GateInput, cycle: ReviewCycle): Action[] {
  return cycle.reviewers
    .filter(
      (name) =>
        !input.history.some(
          (claim) =>
            claim.reviewer === name &&
            claim.commit === cycle.head &&
            !cycle.ignoredSources?.includes(claim.url),
        ),
    )
    .map((name) =>
      scopeAction(
        {
          pr: input.number,
          head: cycle.head,
          kind: "review",
          target: name,
          key: `${input.number}:${cycle.head}:review:${name}`,
          text: `${name} reviews #${input.number} @${cycle.head.slice(0, 7)}`,
        },
        cycle.since,
        cycle.ordinal,
      ),
    );
}

export function scopeAction(
  action: Action,
  since?: string,
  ordinal = 1,
): Action {
  if (!since) return action;
  return {
    ...action,
    kind: "confirm",
    since,
    key: `${action.key.replace(":review:", ":confirm:")}:round-${ordinal}`,
    text: `${action.target} confirms #${action.pr} since ${since.slice(0, 7)}, excluding main`,
  };
}

/** A review/evaluation is pinned until it posts; merges never kill it. */
export function preserveRoundAction(action: Action, open: boolean) {
  return (
    open &&
    (FRESH_KINDS.has(action.kind) || action.key.includes(":evaluation-"))
  );
}

export function reviewClaimCounts(
  crew: Database,
  action: Action,
  source: string,
) {
  const ordinal = /:round-(\d+)$/u.exec(action.key)?.[1];
  const cycle = ordinal
    ? reviewCycles(crew, action.pr).find(
        (cycle) => cycle.ordinal === Number(ordinal),
      )
    : undefined;
  return !cycle?.ignoredSources?.includes(source);
}
