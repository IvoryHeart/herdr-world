import {
  pullRequestReadiness,
  shortSha,
  type PullRequestReviewer,
} from "../../../shared/pullRequests";
import { freshPullRequestDetail } from "../../../shared/pullRequestFreshness";
import type { WorkItem } from "../../../shared/worldSources";

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
  /** Check names branch protection requires; a missing one is unknown. */
  requiredChecks?: string[];
  /** How old a verdict may be for `merge-line`. */
  freshMinutes: number;
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
};

export type GateInput = {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  labels: string[];
  /** Open pull requests: World's item, read in detail. */
  item?: WorkItem;
  attempts: CheckAttempt[];
  /** Copy rule result per reviewed commit. */
  copies: Record<string, CopyResult>;
  hold: { reason: string; at: number } | null;
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
    ...requiredChecks(item, config),
    ...reruns(item, input.attempts, config, notes),
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
  return pullRequestReadiness(item, now)
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
}

function requiredChecks(item: WorkItem, config: GateConfig): Condition[] {
  const names = new Set(item.pr?.checks.map((check) => check.name));
  const missing = (config.requiredChecks ?? []).filter(
    (name) => !names.has(name),
  );
  return missing.length
    ? [
        condition(
          "required",
          "unknown",
          `Required but not reported: ${missing.join(", ")}`,
        ),
      ]
    : [];
}

/** A green rerun keeps its failed attempts on record; only known flakes pass. */
function reruns(
  item: WorkItem,
  attempts: CheckAttempt[],
  config: GateConfig,
  notes: string[],
): Condition[] {
  const failed = new Map<string, number>();
  for (const attempt of attempts)
    if (
      !["success", "skipped", "neutral"].includes(
        attempt.conclusion.toLowerCase(),
      )
    )
      failed.set(attempt.name, (failed.get(attempt.name) ?? 0) + 1);
  const result: Condition[] = [];
  for (const check of item.pr?.checks ?? []) {
    const count = failed.get(check.name);
    if (!count || check.state !== "pass") continue;
    const retained = `${check.name}: ${count} failed attempt${count === 1 ? "" : "s"} retained`;
    if (config.flakes.includes(check.name) && count <= config.rerunBudget)
      notes.push(retained);
    else
      result.push(
        condition(
          "rerun",
          "judgment",
          `${retained}; green only after a rerun ${config.flakes.includes(check.name) ? "over budget" : "of a check not on the flake list"}`,
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
  const head = item.headSha!;
  const latestRequired = Math.max(
    0,
    ...reviewers
      .filter((entry) => entry.reviewer && required?.includes(entry.reviewer))
      .map((entry) => entry.at),
  );
  for (const name of required ?? []) {
    const entry = reviewers.find((candidate) => candidate.reviewer === name);
    if (!entry) {
      result.push(
        condition(`review:${name}`, "unmet", `No RESULT from ${name}`),
      );
      continue;
    }
    result.push(requiredClaim(entry, input.copies, head, notes));
  }
  let uncounted = 0;
  for (const entry of reviewers) {
    if (entry.reviewer && required?.includes(entry.reviewer)) continue;
    if (!entry.reviewer) {
      // An unattributed post newer than the required claims may carry findings.
      if (entry.at > latestRequired)
        result.push(
          condition(
            "unattributed",
            "unknown",
            "An unattributed RESULT is newer than the required reviewers' claims; inspect it",
            entry.url,
          ),
        );
      else uncounted++;
      continue;
    }
    // Findings stay open until the reviewer who raised them confirms.
    if (entry.outcome === "open")
      result.push(
        condition(
          `review:${entry.reviewer}`,
          "unmet",
          `${entry.reviewer}: ${entry.line}`,
          entry.url,
        ),
      );
    else if (entry.outcome === "unknown")
      result.push(
        condition(
          `review:${entry.reviewer}`,
          "unknown",
          `Can't read ${entry.reviewer}'s result`,
          entry.url,
        ),
      );
  }
  if (uncounted)
    notes.push(
      `${uncounted} older unattributed RESULT post${uncounted === 1 ? " was" : "s were"} not counted`,
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

function requiredClaim(
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
        `${at} outdated for ${shortSha(head)}${copy.detail ? ` (${copy.detail})` : ""}`,
        entry.url,
      );
    case "conflict":
      return condition(
        id,
        "unmet",
        `${at}: the main merge since needs ${name}'s confirmation${copy.detail ? ` (${copy.detail})` : ""}`,
        entry.url,
      );
    default:
      return condition(
        id,
        "unknown",
        `${at}: can't tell whether it counts for ${shortSha(head)}${copy.detail ? ` (${copy.detail})` : ""}`,
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
