import type { RoundContext } from "./round-policy";
import type { ReviewCycle } from "./round-policy-store";
import { getMeta } from "./store";

/** Explicit one-confirm exception; no reset, finding waiver or default fourth cycle. */
export function confirmationException(
  context: RoundContext,
  last: ReviewCycle,
) {
  if (last.ordinal !== 3) return null;
  const key = `confirmation-exception:${context.input.number}:${last.ordinal}`;
  const raw = getMeta(context.crew, key);
  if (!raw) return null;
  try {
    const grant = JSON.parse(raw);
    return grant.authorizedBy === "firstmate-2" &&
      grant.permission === "one-scoped-confirmation" &&
      grant.afterOrdinal === last.ordinal &&
      grant.reviewedHead === last.head &&
      grant.targetHead === context.input.item?.headSha &&
      grant.usedCycle === null &&
      Array.isArray(grant.reviewers) &&
      grant.reviewers.toSorted().join("\0") ===
        last.reviewers.toSorted().join("\0")
      ? { key, grant }
      : null;
  } catch {
    return null;
  }
}
