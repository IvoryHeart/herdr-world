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
import {
  observeReviewFacts,
  openFindings,
  type ReviewFacts,
  withReplies,
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
  let other = context.actions.filter(
    (action) => !REVIEW_KINDS.has(action.kind),
  );
  const observeKey = `review-observation:${input.number}`;
  const prior = getMeta(crew, observeKey);
  const observed = prior
    ? (JSON.parse(prior) as { head: string; at: number })
    : null;
  const quietSince = observed?.head === head ? observed.at : now;
  if (!dryRun && observed?.head !== head) {
    setMeta(crew, observeKey, JSON.stringify({ head, at: now }));
    recordPush(crew, input.number, head, now, null);
  }
  const skip = (reason: string, carry = false) => {
    if (!dryRun) {
      recordPush(crew, input.number, head, now, reason);
      if (carry && last) saveReviewCarry(crew, input, last);
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
    return [
      ...judgment(error instanceof Error ? error.message : String(error)),
      ...outstanding(input, last),
    ];
  }
  const findings = withReplies(
    openFindings(input, facts.posts),
    facts.posts,
    author,
    input.number,
  );
  other = other.map((action) =>
    action.kind === "fix"
      ? {
          ...action,
          text: `${action.text}\nReply to each finding using its ID (or exact file:line):\n${findings.map((finding) => `${finding.id}: ${finding.text}`).join("\n")}`,
        }
      : action,
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
  const repliedOnSameHead =
    last.head === head &&
    claims &&
    findings.length > 0 &&
    findings.every((finding) => finding.reply);
  if (awaitingGoRound && evaluation) {
    other = other.filter((action) => action.kind !== "fix");
    const required = evaluation.findings.filter((finding) =>
      evaluation!.required?.includes(finding.id),
    );
    if (
      author &&
      required.length &&
      claims?.some((claim) => claim?.outcome === "open")
    )
      other.push({
        pr: input.number,
        head,
        kind: "fix",
        target: author,
        key: `${input.number}:${head}:fix:${author}:evaluation-${evaluation.checkpoint}`,
        text: `[crew -> ${author}] Fix ONLY these evaluator-mandatory findings for #${input.number}, push, then reply signed by your seat, one line per finding ID and fixing commit: ${required.map((finding) => `${finding.id}: ${finding.text}`).join("; ")}. Follow-up issues are outside this fix pass.`,
      });
  }
  if (last.head === head && !awaitingGoRound && !repliedOnSameHead)
    return [...other, ...outstanding(input, last)];
  // Do not interrupt an earlier round on any push. It supplies the findings
  // and accepted baseline that the subsequent scoped round must use.
  if (!claims)
    return [
      ...skip(
        facts.onlyMain
          ? "merge of main; running round preserved"
          : "previous round still running",
      ),
      ...outstanding(input, last),
    ];
  if (facts.onlyMain)
    return skip("only a merge of origin/main; wait for checks");
  if (facts.onlyHarness)
    return skip("only CI or test-harness repairs; wait for checks", true);
  const mandatory = awaitingGoRound ? evaluation!.required : undefined;
  const selected = mandatory
    ? withReplies(
        evaluation!.findings.filter((finding) =>
          mandatory.includes(finding.id),
        ),
        facts.posts,
        author,
        input.number,
      )
    : findings;
  if (
    !mandatory &&
    author &&
    selected.length &&
    !other.some((action) => action.kind === "fix")
  )
    other.push({
      pr: input.number,
      head,
      kind: "fix",
      target: author,
      key: `${input.number}:${head}:fix:${author}:round-${last.ordinal}`,
      text: `[crew -> ${author}] Address every finding for #${input.number}, push fixes and reply signed by your seat, one line per finding ID and fixing commit: ${selected.map((finding) => `${finding.id}: ${finding.text}`).join("; ")}. Reviews wait for every reply and 10 minutes without a push.`,
    });
  if (
    last.head !== head &&
    selected.length &&
    selected.every((finding) => finding.file !== null) &&
    !selected.some((finding) => facts.files.includes(finding.file!))
  )
    return skip("push touches no open finding's files; wait for checks");
  if (selected.some((finding) => !finding.reply))
    return skip("waiting for a reply to every open finding");
  if (now - quietSince < QUIET_MS)
    return skip("waiting for 10 minutes without a push");
  const nextReviews = reviews.length
    ? reviews
    : awaitingGoRound || repliedOnSameHead
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
