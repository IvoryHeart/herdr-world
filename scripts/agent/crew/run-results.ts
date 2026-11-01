import {
  reviewerResults,
  type Post,
} from "../../../server/src/sources/pullRequestDetail";
import { evaluationVerdict } from "./evaluator";
import type { Action } from "./plan";
import { REVIEW_KINDS } from "./round-actions";
import type { Evaluation } from "./round-policy-store";

/**
 * A task's own posted result finishes that task, independently of whether its
 * commit still belongs to the PR. This grants no review carry or merge readiness.
 */
export function postedResult(
  action: Action,
  posts: Post[],
  evaluation?: Evaluation,
) {
  for (const post of posts.toSorted((a, b) => b.at - a.at)) {
    if (REVIEW_KINDS.has(action.kind)) {
      const [claim] = reviewerResults(
        action.pr,
        [{ ...post, commit: undefined }],
        [{ oid: action.head, at: 0 }],
        action.head,
      );
      if (
        claim?.reviewer === action.target &&
        claim.commit === action.head &&
        claim.outcome !== "unknown"
      )
        return {
          commit: action.head,
          line: `RESULT #${action.pr}: ${claim.line.trim()}`,
          source: claim.url,
        };
    } else if (
      action.kind === "evaluate" &&
      action.target === "evaluator" &&
      evaluation?.head === action.head &&
      action.key.endsWith(`:evaluation-${evaluation.checkpoint}`) &&
      typeof post.body === "string"
    ) {
      const verdict = evaluationVerdict(
        {
          id: String(post.id ?? ""),
          body: post.body,
          at: post.at,
          url: String(post.url ?? ""),
        },
        evaluation,
      );
      if (verdict)
        return {
          commit: action.head,
          line: `EVALUATION #${action.pr}: ${verdict.verdict} — ${verdict.next}`,
          source: verdict.source,
        };
    }
  }
  return undefined;
}
