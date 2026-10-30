import type { Action } from "./plan";
import type { RoundContext } from "./round-policy";
import type { Evaluation, Finding, ReviewCycle } from "./round-policy-store";
import { getAction, setAction } from "./store";

/** A fix request survives pushes and reopens when answered findings recur. */
export function findingFix(
  context: RoundContext,
  cycle: ReviewCycle,
  findings: Finding[],
  evaluation?: Evaluation,
): Action | null {
  if (!context.author) return null;
  const suffix = evaluation
    ? `evaluation-${evaluation.checkpoint}`
    : `round-${cycle.ordinal}`;
  const key = `${cycle.pr}:${evaluation?.head ?? cycle.head}:fix:${context.author}:${suffix}`;
  const missing = findings.filter((finding) => !finding.reply);
  const known = getAction(context.crew, key);
  if (!missing.length) {
    if (!context.dryRun && known && ["pending", "sent"].includes(known.state))
      setAction(context.crew, key, "done", context.now, "findings answered");
    return null;
  }
  // addAction revives superseded requests with fresh text and reset attempts.
  // Sent requests stay sent, so repeat passes do not prompt again.
  const rejectedAt = Math.max(
    ...missing.map((finding) => finding.respondAfter ?? finding.at),
  );
  if (
    !context.dryRun &&
    known?.state === "done" &&
    (known.detail === "findings answered" || rejectedAt > known.updatedAt)
  )
    setAction(context.crew, key, "superseded", context.now);
  return {
    key,
    pr: cycle.pr,
    head: context.input.item!.headSha!,
    kind: "fix",
    target: context.author,
    text: `[crew -> ${context.author}] ACT #${cycle.pr} fix @${cycle.head.slice(0, 7)}: ${evaluation ? "Fix ONLY these evaluator-mandatory findings" : "Address every finding"}, push fixes and reply signed by your seat, one line per finding ID or exact file:line naming its fixing commit: ${missing.map((finding) => `${finding.id}: ${finding.text}`).join("; ")}. Reviews wait for fresh replies and 10 quiet minutes.${evaluation ? " Follow-up issues are outside this fix pass." : ""}`,
  };
}
