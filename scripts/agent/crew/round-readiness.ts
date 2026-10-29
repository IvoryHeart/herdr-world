import type { Database } from "bun:sqlite";
import { type GateInput, type Verdict, verdictState } from "../gate/predicate";
import { evaluations, type ReviewCycle } from "./round-policy-store";
import { getMeta, setMeta } from "./store";

type Carry = { head: string; sources: Record<string, string> };

/** Only fully confirmed evidence can survive a proven CI/harness-only delta. */
export function saveReviewCarry(
  crew: Database,
  input: GateInput,
  cycle: ReviewCycle,
) {
  if (!input.historyComplete) return;
  const sources: Record<string, string> = {};
  for (const name of cycle.reviewers) {
    const claim = input.history.findLast(
      (claim) =>
        claim.reviewer === name &&
        claim.commit === cycle.head &&
        !cycle.ignoredSources?.includes(claim.url),
    );
    const latest = input.item?.pr?.reviewers.find(
      (claim) => claim.reviewer === name,
    );
    if (
      claim?.outcome !== "confirmed" ||
      latest?.url !== claim.url ||
      latest.outcome !== "confirmed" ||
      latest.commit !== cycle.head
    )
      return;
    sources[name] = claim.url;
  }
  if (Object.keys(sources).length)
    setMeta(
      crew,
      `review-carry:${input.number}:${input.item!.headSha}`,
      JSON.stringify({ head: cycle.head, sources } satisfies Carry),
    );
}

/** Crew admission adds workflow evidence; the report-only gate remains conservative. */
export function crewVerdict(
  crew: Database,
  verdict: Verdict,
  input?: GateInput,
): Verdict {
  if (verdict.state === "CLOSED" || verdict.state === "MERGED") return verdict;
  let result = verdict;
  const raw = getMeta(crew, `review-carry:${verdict.number}:${verdict.head}`);
  if (raw && input?.historyComplete) {
    const carry = JSON.parse(raw) as Carry;
    const conditions = verdict.conditions.map((condition) => {
      if (!condition.id.startsWith("review:")) return condition;
      const name = condition.id.slice(7);
      const claim = input.item?.pr?.reviewers.find(
        (claim) => claim.reviewer === name,
      );
      return claim?.outcome === "confirmed" &&
        claim.commit === carry.head &&
        claim.url === carry.sources[name]
        ? {
            ...condition,
            state: "met" as const,
            detail: `${name}: confirmed ${carry.head.slice(0, 7)}; CI/harness-only delta`,
          }
        : condition;
    });
    result = { ...verdict, conditions, state: verdictState(conditions) };
  }
  const evaluation = evaluations(crew, verdict.number).at(-1);
  if (!evaluation || !["evaluating", "process"].includes(evaluation.status))
    return result;
  return {
    ...result,
    state: "WAITING",
    conditions: [
      ...result.conditions.filter(
        (condition) => condition.id !== "crew-evaluation",
      ),
      {
        id: "crew-evaluation",
        state: "waiting",
        detail: `Evaluator hold after round ${evaluation.checkpoint}`,
      },
    ],
  };
}
