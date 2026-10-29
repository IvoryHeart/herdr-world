import type { Action } from "./plan";
import type { RoundContext } from "./round-policy";
import type { Evaluation, Finding, ReviewCycle } from "./round-policy-store";
import { getAction, setAction } from "./store";

/** A review cycle gets one fix request, retained across pushes until answered. */
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
  if (!missing.length) {
    const known = getAction(context.crew, key);
    if (!context.dryRun && known && ["pending", "sent"].includes(known.state))
      setAction(context.crew, key, "done", context.now);
    return null;
  }
  return {
    key,
    pr: cycle.pr,
    head: context.input.item!.headSha!,
    kind: "fix",
    target: context.author,
    text: `[crew -> ${context.author}] ACT #${cycle.pr} fix @${cycle.head.slice(0, 7)}: ${evaluation ? "Fix ONLY these evaluator-mandatory findings" : "Address every finding"}, push fixes and reply signed by your seat, one line per finding ID or exact file:line naming its fixing commit: ${missing.map((finding) => `${finding.id}: ${finding.text}`).join("; ")}. Reviews wait for fresh replies and 10 quiet minutes.${evaluation ? " Follow-up issues are outside this fix pass." : ""}`,
  };
}
