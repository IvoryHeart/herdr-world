import {
  completed,
  outstanding,
  REVIEW_KINDS,
  scopeAction,
} from "./round-actions";
export {
  FRESH_KINDS,
  preserveRoundAction,
  reviewClaimCounts,
} from "./round-actions";
import { adoptCycles } from "./round-adoption";
import type { Database } from "bun:sqlite";
import type { GateInput } from "../gate/predicate";
import type { Deps } from "./deps";
import { evaluationVerdict, processReport } from "./evaluator";
import { type Action, type CrewSettings } from "./plan";
import { harnessOf } from "./worker";
import { saveReviewCarry } from "./round-readiness";
import { findingFix } from "./round-fixes";
import {
  observeReviewFacts,
  openFindings,
  type ReviewFacts,
  withReplies,
  ReviewFactsError,
} from "./review-facts";
import {
  type Evaluation,
  evaluations,
  recordPush,
  saveCycle,
  saveEvaluation,
} from "./round-policy-store";
import {
  finishRun,
  getMeta,
  getAction,
  latestRun,
  roundFor,
  setAction,
  setMeta,
  setRunResult,
  deleteMeta,
} from "./store";

export const QUIET_MS = 10 * 60_000;
export type RoundContext = {
  crew: Database;
  input: GateInput;
  actions: Action[];
  settings: CrewSettings;
  repo: string;
  dir: string;
  now: number;
  dryRun: boolean;
  author: string | null;
  deps: Deps;
  requiredReviewers: string[];
};

function auxiliary(
  evaluation: Evaluation,
  kind: "evaluate" | "process" | "judgment",
  target: string,
  text: string,
): Action {
  return {
    key: `${evaluation.pr}:${evaluation.head}:${kind}:${target}:evaluation-${evaluation.checkpoint}`,
    pr: evaluation.pr,
    head: evaluation.head,
    kind,
    target,
    text,
  };
}

/** A persistent admission policy, shared by real passes and read-only dry runs. */
export function roundPolicy(context: RoundContext): Action[] {
  const { crew, input, settings, now, dryRun, author, deps } = context;
  const head = input.item?.headSha;
  if (!head || input.state !== "OPEN") return context.actions;
  const cycles = adoptCycles(context);
  const last = cycles.at(-1);
  const reviews = context.actions.filter((action) =>
    REVIEW_KINDS.has(action.kind),
  );
  const other = context.actions.filter(
    (action) => !REVIEW_KINDS.has(action.kind) && action.kind !== "fix",
  );
  const observeKey = `review-observation:${input.number}`;
  const prior = getMeta(crew, observeKey);
  const observed = prior
    ? (JSON.parse(prior) as { head: string; at: number })
    : null;
  let quietSince = observed?.head === head ? observed.at : now;
  if (!dryRun && observed?.head !== head) {
    setMeta(crew, observeKey, JSON.stringify({ head, at: now }));
    recordPush(crew, input.number, head, now, null);
  }
  const skip = (reason: string, carry = false) => {
    if (!dryRun) {
      recordPush(crew, input.number, head, now, reason);
      if (carry && last) saveReviewCarry(crew, input, last, facts.files);
    }
    return other;
  };
  const judgment = (reason: string) => [
    ...other,
    {
      key: `${input.number}:${head}:judgment:owner:round-policy`,
      pr: input.number,
      head,
      kind: "judgment" as const,
      target: "owner",
      text: `NEEDS-OWNER #${input.number}: ${reason}`,
    },
  ];
  if (!last) {
    if (reviews.length && !dryRun) {
      const round = roundFor(crew, input.number, head, now);
      saveCycle(crew, {
        pr: input.number,
        head,
        round: round.round,
        ordinal: 1,
        reviewers: context.requiredReviewers,
        trigger: { replies: [], quietSince, reason: "first full review" },
      });
    }
    return context.actions;
  }
  const previousEvaluation = evaluations(crew, input.number).at(-1);
  if (
    last.head === head &&
    !previousEvaluation &&
    last.ordinal < 2 &&
    !context.actions.some((action) => action.kind === "fix")
  )
    return [...other, ...outstanding(input, last)];
  let facts: ReviewFacts;
  const failureKey = `review-facts-errors:${input.number}`;
  try {
    facts = observeReviewFacts(
      deps.run,
      context.dir,
      context.repo,
      input,
      last.head,
    );
  } catch (error) {
    // An in-flight round can still finish on its pinned head. Incomplete
    // evidence must not open another round or release an evaluator hold.
    const prior = getMeta(crew, failureKey);
    const failure = prior
      ? (JSON.parse(prior) as { head: string; count: number })
      : null;
    const count = failure?.head === head ? failure.count + 1 : 1;
    if (!dryRun) setMeta(crew, failureKey, JSON.stringify({ head, count }));
    const escalate =
      (error instanceof ReviewFactsError && error.permanent) || count >= 3;
    return [
      ...(escalate
        ? judgment(error instanceof Error ? error.message : String(error))
        : other),
      ...outstanding(input, last),
    ];
  }
  if (!dryRun) deleteMeta(crew, failureKey);
  const findings = withReplies(
    openFindings(input, facts.posts),
    facts.posts,
    author,
    input.number,
  );
  let evaluation = evaluations(crew, input.number).at(-1);
  const claims = completed(input, last);
  const nonconverged = input.item?.pr?.reviewers.some(
    (claim) => claim.outcome === "open",
  );
  if (
    claims &&
    nonconverged &&
    last.ordinal >= (evaluation?.checkpoint ?? 0) + 2 &&
    (last.ordinal - (evaluation?.checkpoint ?? 0)) % 2 === 0
  ) {
    evaluation = {
      pr: input.number,
      checkpoint: last.ordinal,
      head,
      round: last.round,
      findings,
      status: "evaluating",
    };
    if (!dryRun) saveEvaluation(crew, evaluation);
  }
  if (evaluation?.status === "evaluating") {
    const verdict = facts.posts
      .map((post) => evaluationVerdict(post, evaluation!))
      .findLast(Boolean);
    if (verdict) {
      evaluation = {
        ...evaluation,
        ...verdict,
        status: verdict.verdict === "go" ? "go" : "process",
      };
      if (!dryRun) {
        saveEvaluation(crew, evaluation);
        finishAuxiliary(
          context,
          auxiliary(evaluation, "evaluate", "evaluator", ""),
          `EVALUATION #${input.number}: ${verdict.verdict} — ${verdict.next}`,
        );
      }
    } else {
      const model = settings.roster.evaluator;
      if (model?.model !== "claude-opus-5-5")
        return judgment("evaluator needs a claude-opus-5-5 roster entry");
      // Fix/CI prompts wait while the evaluator decides the next process.
      return [
        auxiliary(
          evaluation,
          "evaluate",
          "evaluator",
          `Evaluate #${input.number} after round ${evaluation.checkpoint}`,
        ),
      ];
    }
  }
  if (evaluation?.status === "process") {
    const report = processReport(facts.posts, evaluation);
    if (report) {
      evaluation = {
        ...evaluation,
        status: "reported",
        report: report.url || report.id,
      };
      if (!dryRun) {
        saveEvaluation(crew, evaluation);
        if (evaluation.seat)
          finishAuxiliary(
            context,
            auxiliary(evaluation, "process", evaluation.seat, ""),
            report.body,
          );
      }
    } else {
      const owner = auxiliary(
        evaluation,
        "judgment",
        "owner",
        `NEEDS-OWNER #${input.number}: evaluator no-go: ${evaluation.next}. ${evaluation.process === "owner" ? "Reply at reception with the decision and next step to release the review hold." : `Starting ${evaluation.process} with ${evaluation.seat}; reviews held until its PROCESS report.`}`,
      );
      if (evaluation.process === "owner") return [owner];
      if (!evaluation.seat || !settings.roster[evaluation.seat])
        return [
          owner,
          ...judgment(
            "evaluator selected a process seat missing from the roster",
          ).filter((action) => action.kind === "judgment"),
        ];
      if (!harnessOf(settings.roster[evaluation.seat]!))
        return [
          owner,
          ...judgment(
            "evaluator selected a process seat whose model has no harness",
          ).filter((action) => action.kind === "judgment"),
        ];
      if (evaluation.process === "fresh-fixer" && evaluation.seat === author)
        return [
          owner,
          ...judgment(
            "fresh-fixer requires a different persona from the author",
          ).filter((action) => action.kind === "judgment"),
        ];
      return [
        owner,
        auxiliary(
          evaluation,
          "process",
          evaluation.seat,
          `Carry out ${evaluation.process} for #${input.number}: ${evaluation.next}`,
        ),
      ];
    }
  }
  const awaitingGoRound =
    evaluation?.status === "go" && last.ordinal === evaluation.checkpoint;
  if (awaitingGoRound && evaluation && evaluation.verdictAt === undefined) {
    evaluation = {
      ...evaluation,
      verdictAt:
        facts.posts.find(
          (post) =>
            post.url === evaluation!.source || post.id === evaluation!.source,
        )?.at ?? now,
    };
    if (!dryRun) saveEvaluation(crew, evaluation);
  }
  // A scoped round's old findings cannot request author work while fresh
  // confirmations are outstanding, even if the head has not changed.
  if (!claims)
    return [
      ...skip(
        facts.onlyMain
          ? "merge of main; running round preserved"
          : "previous round still running",
      ),
      ...outstanding(input, last),
    ];
  const mandatory = awaitingGoRound ? evaluation!.required : undefined;
  const deferred =
    evaluation?.status === "go"
      ? new Set(
          evaluation.findings
            .filter((finding) => !evaluation!.required?.includes(finding.id))
            .map((finding) => finding.id),
        )
      : new Set<string>();
  const selected = mandatory
    ? withReplies(
        evaluation!.findings
          .filter((finding) => mandatory.includes(finding.id))
          .map((finding) => ({
            ...finding,
            respondAfter: Math.max(
              finding.respondAfter ?? finding.at,
              findings.find((current) => current.id === finding.id)
                ?.respondAfter ?? 0,
            ),
          })),
        facts.posts,
        author,
        input.number,
        evaluation!.verdictAt,
      )
    : findings.filter((finding) => !deferred.has(finding.id));
  if (awaitingGoRound)
    quietSince = Math.max(quietSince, evaluation!.verdictAt!);
  const fix = findingFix(
    context,
    last,
    selected,
    awaitingGoRound ? evaluation : undefined,
  );
  if (fix) other.push(fix);
  const answered = selected.every((finding) => finding.reply);
  const touchesFinding = selected.some(
    (finding) => finding.file && facts.files.includes(finding.file),
  );
  if (!answered) {
    if (facts.onlyMain)
      return skip("only a merge of origin/main; wait for replies and checks");
    if (facts.onlyHarness && !touchesFinding)
      return skip(
        "only CI or test-harness repairs; wait for replies and checks",
      );
    if (
      last.head !== head &&
      selected.every((finding) => finding.file !== null) &&
      !touchesFinding
    )
      return skip(
        "push touches no open finding's files; wait for replies and checks",
      );
    return skip("waiting for a fresh reply to every open finding");
  }
  if (!selected.length && facts.onlyMain)
    return skip("only a merge of origin/main; wait for checks");
  if (!selected.length && facts.carrySafe)
    return skip("only synthetic test fixtures; wait for checks", true);
  if (last.head === head && !awaitingGoRound && !selected.length) return other;
  if (now - quietSince < QUIET_MS)
    return skip(
      "waiting for 10 quiet minutes after the latest push or evaluator verdict",
    );
  const nextReviews = reviews.length
    ? reviews
    : awaitingGoRound || selected.length
      ? last.reviewers.map(
          (name): Action => ({
            pr: input.number,
            head,
            key: `${input.number}:${head}:confirm:${name}`,
            kind: "confirm",
            target: name,
            text: "",
          }),
        )
      : [];
  if (!nextReviews.length) return other;
  if (!dryRun) {
    const round = roundFor(crew, input.number, head, now, last.head === head);
    saveCycle(crew, {
      pr: input.number,
      head,
      round: round.round,
      ordinal: last.ordinal + 1,
      since: last.head,
      reviewers: nextReviews.map((action) => action.target),
      ignoredSources: input.history
        .filter((claim) => claim.commit === head)
        .map((claim) => claim.url),
      trigger: {
        replies: selected.map((finding) => `${finding.id}: ${finding.reply}`),
        quietSince,
        reason: awaitingGoRound
          ? `evaluator go after round ${evaluation!.checkpoint}`
          : "all finding replies and quiet period",
      },
      ...(mandatory ? { scope: mandatory } : {}),
    });
    recordPush(crew, input.number, head, now, null);
  }
  return [
    ...other.filter((action) => action.kind !== "fix"),
    ...nextReviews.map((action) =>
      scopeAction(action, last.head, last.ordinal + 1),
    ),
  ];
}

function finishAuxiliary(
  context: RoundContext,
  action: Action,
  result: string,
) {
  const run = latestRun(context.crew, action.key);
  if (run) setRunResult(context.crew, run.id, result);
  if (run?.finishedAt === null)
    finishRun(
      context.crew,
      run.id,
      0,
      context.deps.usage(run, context.dir),
      context.now,
    );
  if (getAction(context.crew, action.key))
    setAction(context.crew, action.key, "done", context.now, result);
}

/** An owner decision is the report for a no-go owner process. */
export function reportOwnerDecision(
  crew: Database,
  action: Action,
  text: string,
) {
  const evaluation = evaluations(crew, action.pr).at(-1);
  if (
    evaluation?.status === "process" &&
    evaluation.process === "owner" &&
    action.key === auxiliary(evaluation, "judgment", "owner", "").key
  ) {
    saveEvaluation(crew, { ...evaluation, status: "reported", report: text });
  }
}
