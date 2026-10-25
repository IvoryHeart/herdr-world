import {
  pullRequestReadiness,
  shortSha,
  type PullRequestCheck,
  type PullRequestReviewer,
} from "../../../shared/pullRequests";
import { freshPullRequestDetail } from "../../../shared/pullRequestFreshness";
import type { WorkItem } from "../../../shared/worldSources";
import {
  resultLine,
  resultOutcome,
} from "../../../server/src/sources/pullRequestDetail";

/**
 * READY for the owner's merge, computed from facts and never from a model's
 * claim. World's own readiness rules decide draft, checks, mergeable and
 * screenshots exactly as the PR card does. The gate replaces World's findings
 * rule with the crew's: every required reviewer must confirm a head that
 * still counts, and nobody may have findings open. Everything here is pure:
 * the caller supplies what GitHub and git said.
 */

export type GateConfig = {
  /** `owner/name`. */
  repo: string;
  /** Required reviewers: per PR number, else per `pod:<name>` label, else default. */
  reviewers: {
    default?: string[];
    pods?: Record<string, string[]>;
    prs?: Record<string, string[]>;
  };
  /** Check names whose failed attempt may be rerun once and stay READY. */
  flakes: string[];
  /** Failed attempts of an allowlisted check that a green rerun may cover. */
  rerunBudget: number;
  /**
   * Checks that only summarise others, such as a required roll-up job. Never
   * inferred: a named aggregate's failed attempt is excused only when every
   * other check that failed in that same run attempt is a listed flake
   * within budget.
   */
  aggregateChecks?: string[];
  /**
   * Required checks added to those GitHub's rules report. Set it, even to an
   * empty list, when the rules can't be read or require nothing.
   */
  requiredChecks?: string[];
  /** Git remote for the private mirror; defaults to the GitHub HTTPS URL. */
  remote?: string;
};

/** Whether a reviewer's claim at `commit` still counts for the head. */
export type CopyResult = {
  kind: "same" | "clean-merge" | "outdated" | "conflict" | "unknown";
  detail?: string;
};

/** An earlier, superseded attempt of a check on the head. */
export type CheckAttempt = {
  runId: number;
  attempt: number;
  name: string;
  conclusion: string;
  completedAt: number;
  jobId?: number;
};

/** Which workflow execution an Actions job belongs to. */
export type Execution = {
  /** The workflow run the job belongs to. */
  runId: number;
  workflowId: number;
  /** Increments with each run of the workflow. */
  runNumber: number;
  /** Increments with each rerun of that run. */
  attempt: number;
};

export type GateInput = {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  labels: string[];
  /** Open pull requests: World's item, its reviewers read from full history. */
  item?: WorkItem;
  /** Every reviewer claim on the PR, one per post, oldest first. */
  history: PullRequestReviewer[];
  /** False when GitHub had more reviews or comments than the gate read. */
  historyComplete: boolean;
  /** Check names the base branch requires; null when unknown. */
  requiredChecks: string[] | null;
  attempts: CheckAttempt[];
  /** Execution of each job behind a repeated check, by job ID. */
  executions: Record<string, Execution>;
  /** Copy rule result per reviewed commit. */
  copies: Record<string, CopyResult>;
  hold: { reason: string; at: number } | null;
  /** Unattributed RESULT posts someone explicitly resolved, by source. */
  waived: string[];
  /** Each post's outcome from its full RESULT text, by source; absent is unknown. */
  outcomes: Record<string, PullRequestReviewer["outcome"]>;
  /** Files changed both by the PR and on main since its merge base. */
  overlap: string[] | null;
  readAt: number;
};

export type ConditionState =
  | "met"
  | "unmet"
  | "waiting"
  | "unknown"
  | "judgment";

export type Condition = {
  id: string;
  state: ConditionState;
  detail: string;
  url?: string;
};

export type VerdictState =
  | "READY"
  | "NOT_READY"
  | "NEEDS_JUDGMENT"
  | "UNKNOWN"
  | "WAITING"
  | "MERGED"
  | "CLOSED";

export type Verdict = {
  number: number;
  head: string | null;
  state: VerdictState;
  conditions: Condition[];
  notes: string[];
};

export function evaluate(
  input: GateInput,
  config: GateConfig,
  now: number,
): Verdict {
  const { number } = input;
  if (input.state !== "OPEN")
    return {
      number,
      head: null,
      state: input.state,
      conditions: [],
      notes: [],
    };
  const item = input.item;
  if (!item?.headSha)
    return {
      number,
      head: null,
      state: "UNKNOWN",
      conditions: [
        condition("read", "unknown", "GitHub did not report a head"),
      ],
      notes: [],
    };
  const head = item.headSha;
  const notes: string[] = [];
  const conditions: Condition[] = [
    item.base === "main"
      ? condition("base", "met", "Merges into main")
      : condition(
          "base",
          "unmet",
          `Merges into ${item.base ?? "an unknown branch"}`,
        ),
    ...worldRules(item, now),
    ...requiredChecks(item, input.requiredChecks),
    ...reruns(item, input.attempts, input.executions, config, notes),
    ...findings(input, item, config, now, notes),
    input.hold
      ? condition("hold", "unmet", `Held: ${input.hold.reason}`)
      : condition("hold", "met", "No hold"),
  ];
  if (item.review === "review_required")
    notes.push("GitHub still requires a native approval: an owner action");
  if (input.overlap?.length)
    notes.push(
      `Overlaps main since its base: ${input.overlap.slice(0, 5).join(", ")}${input.overlap.length > 5 ? ", …" : ""}`,
    );
  return { number, head, state: verdictState(conditions), conditions, notes };
}

/**
 * Each post's RESULT outcome from its complete text, keyed like the shared
 * parser's source IDs. The parser's display line is truncated, so judging
 * that line could drop a finding written past the cut.
 */
export function fullOutcomes(
  number: number,
  posts: Record<string, unknown>[],
): Record<string, PullRequestReviewer["outcome"]> {
  const outcomes: Record<string, PullRequestReviewer["outcome"]> = {};
  for (const post of posts) {
    if (typeof post.body !== "string") continue;
    const line = resultLine(post.body, number);
    const id =
      typeof post.id === "string" && post.id ? post.id : String(post.url ?? "");
    if (line !== null && id) outcomes[id] = resultOutcome(line);
  }
  return outcomes;
}

/** The worst condition decides; behind main is never one of them. */
export function verdictState(conditions: Condition[]): VerdictState {
  const has = (state: ConditionState) =>
    conditions.some((entry) => entry.state === state);
  if (has("unmet")) return "NOT_READY";
  if (has("judgment")) return "NEEDS_JUDGMENT";
  if (has("unknown")) return "UNKNOWN";
  if (has("waiting")) return "WAITING";
  return "READY";
}

function worldRules(item: WorkItem, now: number): Condition[] {
  const rules = pullRequestReadiness(item, now)
    .filter((rule) => rule.id !== "findings")
    .map((rule) => {
      if (rule.state === "pass") return condition(rule.id, "met", rule.detail);
      if (rule.state === "fail")
        return condition(rule.id, "unmet", rule.detail);
      // Running checks are progress, not doubt.
      if (rule.id === "checks" && item.checks === "pending")
        return condition(rule.id, "waiting", rule.detail);
      return condition(rule.id, "unknown", rule.detail);
    });
  if (item.pr?.checksTruncated)
    rules.push(
      condition(
        "checks-read",
        "unknown",
        "GitHub listed more checks than were read",
      ),
    );
  return rules;
}

/** A required check that never ran can't flag itself; the inventory names it. */
function requiredChecks(
  item: WorkItem,
  required: string[] | null,
): Condition[] {
  if (required === null)
    return [
      condition(
        "required",
        "unknown",
        "Required checks unknown: GitHub's rules were unreadable or empty; set requiredChecks",
      ),
    ];
  const names = new Set(item.pr?.checks.map((check) => check.name));
  const missing = required.filter((name) => !names.has(name));
  return missing.length
    ? [
        condition(
          "required",
          "unknown",
          `Required but not reported: ${missing.join(", ")}`,
        ),
      ]
    : [condition("required", "met", `${required.length} required reported`)];
}

/** An Actions job's ID, from its details URL. */
export function jobId(check: PullRequestCheck) {
  const match = /\/actions\/runs\/\d+\/job\/(\d+)/u.exec(check.url ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * GitHub lists every run of a check on the commit. Which is authoritative
 * follows the documented workflow order, not job IDs or finishing times:
 * within one workflow, the higher run number and then the higher attempt is
 * newer. Repeated runs that aren't all known executions of one workflow are
 * unordered: the worst of them stands and nothing counts as superseded.
 */
export function latestChecks(
  checks: PullRequestCheck[],
  executions: Record<string, Execution>,
) {
  const groups = new Map<string, PullRequestCheck[]>();
  for (const check of checks)
    groups.set(check.name, [...(groups.get(check.name) ?? []), check]);
  const latest: PullRequestCheck[] = [];
  const superseded: PullRequestCheck[] = [];
  const unordered: string[] = [];
  const worst = { fail: 3, pending: 2, pass: 1, skipped: 0 } as const;
  const execution = (check: PullRequestCheck) => {
    const id = jobId(check);
    return id === null ? undefined : executions[String(id)];
  };
  for (const [name, runs] of groups) {
    if (runs.length === 1) {
      latest.push(runs[0]!);
      continue;
    }
    const known = runs.map(execution);
    const ordered =
      known.every((entry) => entry !== undefined) &&
      new Set(known.map((entry) => entry!.workflowId)).size === 1 &&
      new Set(known.map((entry) => `${entry!.runNumber}/${entry!.attempt}`))
        .size === runs.length;
    const sorted = ordered
      ? runs.toSorted((a, b) => {
          const x = execution(a)!;
          const y = execution(b)!;
          return y.runNumber - x.runNumber || y.attempt - x.attempt;
        })
      : runs.toSorted((a, b) => worst[b.state] - worst[a.state]);
    if (!ordered) unordered.push(name);
    latest.push(sorted[0]!);
    if (ordered) superseded.push(...sorted.slice(1));
  }
  return { latest, superseded, unordered };
}

/** A green rerun keeps its failed attempts on record; only known flakes pass. */
function reruns(
  item: WorkItem,
  attempts: CheckAttempt[],
  executions: Record<string, Execution>,
  config: GateConfig,
  notes: string[],
): Condition[] {
  const { latest, superseded, unordered } = latestChecks(
    item.pr?.checks ?? [],
    executions,
  );
  // Each failed job once, with the run attempt it failed in when known,
  // whether the Actions attempts list or a superseded check run reported it.
  const failures: { name: string; attempt: string | null }[] = [];
  const seen = new Set<number>();
  const record = (
    name: string,
    job: number | null | undefined,
    attempt: string | null,
  ) => {
    if (job != null) {
      if (seen.has(job)) return;
      seen.add(job);
    }
    failures.push({ name, attempt });
  };
  for (const attempt of attempts)
    if (
      !["success", "skipped", "neutral"].includes(
        attempt.conclusion.toLowerCase(),
      )
    )
      record(
        attempt.name,
        attempt.jobId,
        `${attempt.runId}/${attempt.attempt}`,
      );
  // A rerun leaves the earlier execution's checks on the commit.
  for (const check of superseded)
    if (check.state === "fail") {
      const id = jobId(check);
      const execution = id === null ? undefined : executions[String(id)];
      record(
        check.name,
        id,
        execution ? `${execution.runId}/${execution.attempt}` : null,
      );
    }
  const failed = new Map<string, number>();
  for (const failure of failures)
    failed.set(failure.name, (failed.get(failure.name) ?? 0) + 1);
  const excusable = (name: string) =>
    config.flakes.includes(name) &&
    (failed.get(name) ?? 0) <= config.rerunBudget;
  const latestState = new Map(latest.map((check) => [check.name, check.state]));
  // A flake supports an aggregate only once its newest run actually passed:
  // skipped, running, failed or missing is no recovery.
  const recovered = (name: string) =>
    excusable(name) && latestState.get(name) === "pass";
  // An aggregate's failed attempt is excused only by recovered listed flakes
  // failing in that same attempt; alone, beside anything else, or unplaced,
  // it isn't.
  const aggregateExcused = (name: string) =>
    failures
      .filter((failure) => failure.name === name)
      .every((failure) => {
        if (failure.attempt === null) return false;
        const others = failures.filter(
          (other) => other.attempt === failure.attempt && other.name !== name,
        );
        return (
          others.length > 0 && others.every((other) => recovered(other.name))
        );
      });
  const result: Condition[] = unordered.length
    ? [
        condition(
          "checks-order",
          "unknown",
          `Several runs of ${unordered.join(", ")} and no way to tell the newest`,
        ),
      ]
    : [];
  for (const check of latest) {
    const count = failed.get(check.name);
    if (!count || check.state !== "pass") continue;
    const retained = `${check.name}: ${count} failed attempt${count === 1 ? "" : "s"} retained`;
    // A named aggregate is judged only by the aggregate rule, never as a flake.
    if (config.aggregateChecks?.includes(check.name)) {
      if (aggregateExcused(check.name))
        notes.push(
          `${retained}; each failed only with recovered listed flakes`,
        );
      else
        result.push(
          condition(
            "aggregate",
            "judgment",
            `${retained}; green only after a rerun of an aggregate that failed beside more than recovered listed flakes`,
            check.url,
          ),
        );
    } else if (excusable(check.name)) notes.push(retained);
    else
      result.push(
        condition(
          "rerun",
          "judgment",
          `${retained}; green only after a rerun ${
            config.flakes.includes(check.name)
              ? "over budget"
              : "of a check not on the flake list"
          }`,
          check.url,
        ),
      );
  }
  return result;
}

function findings(
  input: GateInput,
  item: WorkItem,
  config: GateConfig,
  now: number,
  notes: string[],
): Condition[] {
  const reviewers = item.pr?.reviewers;
  if (!reviewers || !freshPullRequestDetail(item, now))
    return [
      condition("reviewers", "unknown", "Reviewer results stale or not read"),
    ];
  const { names: required, why } = requiredReviewers(input, config);
  const result: Condition[] = [];
  if (!required) result.push(condition("reviewers", "unknown", why));
  if (!input.historyComplete)
    result.push(
      condition(
        "history",
        "unknown",
        "More reviews or comments than the gate read; older findings may be missed",
      ),
    );
  const head = item.headSha!;
  for (const name of required ?? []) {
    const entry = reviewers.find((candidate) => candidate.reviewer === name);
    if (!entry)
      result.push(
        condition(`review:${name}`, "unmet", `No RESULT from ${name}`),
      );
    else result.push(counting(entry, input.copies, head, notes));
  }
  // Anyone else who ever reported findings must close them on a head that counts.
  const raised = new Set(
    input.history
      .filter((entry) => entry.reviewer && entry.outcome === "open")
      .map((entry) => entry.reviewer!),
  );
  for (const entry of reviewers) {
    if (!entry.reviewer || required?.includes(entry.reviewer)) continue;
    if (entry.outcome === "confirmed" && !raised.has(entry.reviewer)) continue;
    result.push(counting(entry, input.copies, head, notes));
  }
  // Unattributed evidence never counts as a confirmation, and an unowned
  // finding blocks until someone attributes the post or explicitly waives it.
  let waived = 0;
  for (const entry of reviewers) {
    if (entry.reviewer) continue;
    if (input.waived.includes(entry.sourceId ?? entry.url)) {
      waived++;
      continue;
    }
    // Judged on the full RESULT text: the display line is truncated.
    if (input.outcomes[entry.sourceId ?? entry.url] !== "confirmed")
      result.push(
        condition(
          "unattributed",
          "judgment",
          `Unattributed RESULT "${entry.line}" may report findings; attribute the post or waive ${entry.sourceId ?? entry.url}`,
          entry.url,
        ),
      );
  }
  if (waived)
    notes.push(
      `${waived} unattributed RESULT post${waived === 1 ? "" : "s"} waived`,
    );
  return result;
}

/** Most specific first: this PR, its pod, then the crew default. */
export function requiredReviewers(
  input: Pick<GateInput, "number" | "labels">,
  config: GateConfig,
): { names: string[] | undefined; why: string } {
  const own = config.reviewers.prs?.[String(input.number)];
  if (own?.length) return { names: own, why: `set for #${input.number}` };
  const pods = input.labels
    .filter((label) => label.startsWith("pod:"))
    .map((label) => label.slice(4));
  const configured = pods.filter((pod) => config.reviewers.pods?.[pod]?.length);
  if (configured.length > 1)
    return {
      names: undefined,
      why: `Several pod labels with reviewers: ${configured.join(", ")}`,
    };
  if (configured.length === 1)
    return {
      names: config.reviewers.pods![configured[0]!],
      why: `pod:${configured[0]}`,
    };
  if (config.reviewers.default?.length)
    return { names: config.reviewers.default, why: "crew default" };
  return {
    names: undefined,
    why: "No required reviewers configured for this PR",
  };
}

/** The reviewer's latest claim must confirm, on a head that counts for `head`. */
function counting(
  entry: PullRequestReviewer,
  copies: Record<string, CopyResult>,
  head: string,
  notes: string[],
): Condition {
  const id = `review:${entry.reviewer}`;
  const name = entry.reviewer!;
  if (entry.outcome === "open")
    return condition(id, "unmet", `${name}: ${entry.line}`, entry.url);
  if (entry.outcome === "unknown")
    return condition(id, "unknown", `Can't read ${name}'s result`, entry.url);
  if (!entry.commit)
    return condition(
      id,
      "unknown",
      `${name} confirmed, head unknown`,
      entry.url,
    );
  if (entry.commit === head)
    return condition(
      id,
      "met",
      `${name} confirmed ${shortSha(head)}`,
      entry.url,
    );
  const copy = copies[entry.commit] ?? { kind: "unknown" as const };
  const at = `${name}: claim at ${shortSha(entry.commit)}`;
  const detail = copy.detail ? ` (${copy.detail})` : "";
  switch (copy.kind) {
    case "same":
    case "clean-merge":
      notes.push(
        `${at} carried to ${shortSha(head)} across a clean main merge`,
      );
      return condition(
        id,
        "met",
        `${at} counts for ${shortSha(head)}`,
        entry.url,
      );
    case "outdated":
      return condition(
        id,
        "unmet",
        `${at} outdated for ${shortSha(head)}${detail}`,
        entry.url,
      );
    case "conflict":
      return condition(
        id,
        "unmet",
        `${at}: the main merge since needs ${name}'s confirmation${detail}`,
        entry.url,
      );
    default:
      return condition(
        id,
        "unknown",
        `${at}: can't tell whether it counts for ${shortSha(head)}${detail}`,
        entry.url,
      );
  }
}

function condition(
  id: string,
  state: ConditionState,
  detail: string,
  url?: string,
): Condition {
  return url ? { id, state, detail, url } : { id, state, detail };
}
