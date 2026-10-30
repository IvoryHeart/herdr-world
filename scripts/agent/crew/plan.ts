import { readFileSync } from "node:fs";
import { shortSha } from "../../../shared/pullRequests";
import { type GateInput, latestChecks, type Verdict } from "../gate/predicate";
import { harnessOf } from "./worker";

/**
 * What the crew watcher does about one pull request's verdict, and its
 * settings. Planning is pure: the
 * same verdict always plans the same actions under the same keys, so a pass
 * that runs twice, or after a crash, never acts twice.
 */

export type CrewSettings = {
  /** Pilot scope: pull requests labelled `pod:<name>`. Empty means every PR. */
  pods: string[];
  /** Pull requests in scope regardless of their labels. */
  prs: number[];
  /** Pod → lead seat, the author of a `batch/<pod>-<n>` branch. */
  leads: Record<string, string>;
  /** PR number → author seat, when the branch doesn't name one. */
  authors: Record<string, string>;
  /** Seats the watcher never types into, such as the owner's front desk. */
  neverPrompt: string[];
  /** Reviewer runs at once. */
  maxRuns: number;
  /** A reviewer still working after this long, without posting, is the owner's call. */
  runTimeoutMinutes: number;
  /**
   * A check still running this long after the watcher first saw it is
   * stuck, as when GitHub loses a finished job's status; the author reruns it.
   */
  stallMinutes: number;
  /**
   * Seat → how it runs: a reviewer runs fresh on its seat's model, and
   * `seat start` launches a seat with exactly these settings.
   */
  roster: Record<string, RosterEntry>;
  /**
   * The seat told once when an owner ask fails or reaches no one, such as
   * the FirstMate seat; unset, the failure is only in the feed.
   */
  escalate?: string;
};

export type RosterEntry = {
  model: string;
  effort?: string;
  /** Defaults to the harness that runs the model; see `harnessOf`. */
  harness?: "claude" | "codex";
  /** The seat's standing instructions, given as its system prompt. */
  persona?: string;
};

export type ActionKind =
  | "fix"
  | "ci"
  | "conflict"
  | "screenshots"
  | "review"
  | "confirm"
  | "evaluate"
  | "process"
  | "ready"
  | "judgment";

export type Action = {
  /** Stable per PR, head, kind and target. */
  key: string;
  pr: number;
  head: string;
  kind: ActionKind;
  /** The seat to prompt, the reviewer to run, or `owner`. */
  target: string;
  text: string;
  /** A confirmation: the reviewer's last claimed commit. */
  since?: string;
};

export const SETTINGS_DEFAULTS: CrewSettings = {
  pods: [],
  prs: [],
  leads: {},
  authors: {},
  neverPrompt: [],
  maxRuns: 3,
  runTimeoutMinutes: 90,
  stallMinutes: 30,
  roster: {},
};

/** A short, stable digest (FNV-1a) that tells repeated causes apart in keys. */
export function digest(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function inScope(input: GateInput, settings: CrewSettings) {
  if (settings.prs.includes(input.number)) return true;
  if (!settings.pods.length) return true;
  return input.labels.some(
    (label) =>
      label.startsWith("pod:") && settings.pods.includes(label.slice(4)),
  );
}

/**
 * The seat that owns a branch: a configured override, a pod lead for
 * `batch/<pod>-<n>`, or the longest known seat name after `agent/`.
 */
export function authorOf(
  pr: number,
  branch: string | undefined,
  settings: CrewSettings,
  seats: string[],
): string | null {
  const own = settings.authors[String(pr)];
  if (own) return own;
  if (!branch) return null;
  const batch = /^batch\/([a-z0-9-]+?)-\d+$/u.exec(branch);
  if (batch) return settings.leads[batch[1]!] ?? null;
  if (!branch.startsWith("agent/")) return null;
  const rest = branch.slice(6);
  const match = seats
    .filter((seat) => rest === seat || rest.startsWith(`${seat}-`))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? null;
}

/**
 * A PR's checks without the attempts a later attempt of the same workflow
 * provably replaced. Same-name checks the gate can't order all stay: none
 * of them replaced another, so each can still pass, fail or run.
 */
export function currentChecks(input: GateInput) {
  const checks = input.item?.pr?.checks ?? [];
  const replaced = new Set(latestChecks(checks, input.executions).superseded);
  return checks.filter((check) => !replaced.has(check));
}

/**
 * In-scope open PRs where something can change within minutes: a check
 * still running, an open step such as a reviewer at work, or a READY PR the
 * owner may merge, which closes its pod. The watcher reads these more often.
 */
export function busyPrs(
  verdicts: Verdict[],
  inputs: GateInput[],
  settings: CrewSettings,
  open: number[],
) {
  const byNumber = new Map(inputs.map((input) => [input.number, input]));
  const busy: number[] = [];
  for (const verdict of verdicts) {
    const input = byNumber.get(verdict.number);
    if (
      !input ||
      input.state !== "OPEN" ||
      !inScope(input, settings) ||
      isOnHold(input)
    )
      continue;
    if (
      verdict.state === "READY" ||
      open.includes(verdict.number) ||
      currentChecks(input).some((check) => check.state === "pending")
    )
      busy.push(verdict.number);
  }
  return [...new Set(busy)].sort((a, b) => a - b);
}

/**
 * The watcher's marks: commit statuses on a PR's head, which start no CI
 * run (a label would) and which a new push leaves behind. The gate and the
 * PR card don't count them as checks.
 */
export const MERGE_READY = "crew/merge-ready";
export const NEEDS_OWNER = "crew/needs-owner";

export type Mark = {
  context: typeof MERGE_READY | typeof NEEDS_OWNER;
  state: "success" | "pending";
  description: string;
  /** Set only to take back an earlier mark on the same head. */
  revokes?: true;
};

/**
 * Safe to merge: READY with at least one required review, every one of them
 * confirmed on this head. A PR no reviewer has finished never qualifies,
 * even when no reviewers are configured for it.
 */
export function mergeReady(verdict: Verdict) {
  const reviews = verdict.conditions.filter((entry) =>
    entry.id.startsWith("review:"),
  );
  return (
    verdict.state === "READY" &&
    reviews.length > 0 &&
    reviews.every((entry) => entry.state === "met")
  );
}

/** GitHub caps a status description at 140 characters. */
const short = (text: string) =>
  text.length > 140 ? `${text.slice(0, 139)}…` : text;

/**
 * The marks an open PR's head should carry: `crew/merge-ready` while it is
 * in scope, not held (by label or `agent:gate hold`) and `mergeReady`, and `crew/needs-owner` while it is in
 * scope and the owner has `causes` to decide. A mark that no longer holds is
 * taken back, which only matters if it was set on this head.
 */
export function marks(
  verdict: Verdict,
  input: GateInput,
  settings: CrewSettings,
  causes: string[],
): Mark[] {
  if (input.state !== "OPEN" || !verdict.head) return [];
  const held =
    isOnHold(input) ||
    verdict.conditions.some(
      (entry) => entry.id === "hold" && entry.state === "unmet",
    );
  const watched = inScope(input, settings) && !held;
  const reviewers = verdict.conditions
    .filter((entry) => entry.id.startsWith("review:"))
    .map((entry) => entry.id.slice(7));
  const ready: Mark =
    watched && mergeReady(verdict)
      ? {
          context: MERGE_READY,
          state: "success",
          description: short(
            `READY at ${shortSha(verdict.head)}; confirmed by ${reviewers.join(", ")}`,
          ),
        }
      : {
          context: MERGE_READY,
          state: "pending",
          description: short(`Not merge-ready: ${verdict.state}`),
          revokes: true,
        };
  const owner: Mark =
    watched && causes.length
      ? {
          context: NEEDS_OWNER,
          state: "pending",
          description: short(
            `Needs the owner: ${causes[0]}${causes.length > 1 ? ` (+${causes.length - 1} more)` : ""}`,
          ),
        }
      : {
          context: NEEDS_OWNER,
          state: "success",
          description: "Nothing waits on the owner",
          revokes: true,
        };
  return [ready, owner];
}

/** The owner can park a PR with the `on-hold` label without leaving watch scope. */
export function isOnHold(input: GateInput) {
  return input.labels.includes("on-hold");
}

/** A check the watcher has seen running for `minutes`. */
export type RunningCheck = { name: string; url: string; minutes: number };

export function plan(
  verdict: Verdict,
  input: GateInput,
  settings: CrewSettings,
  seats: string[],
  running: RunningCheck[] = [],
): Action[] {
  const { number: pr, head } = verdict;
  if (!head || verdict.state === "MERGED" || verdict.state === "CLOSED")
    return [];
  if (isOnHold(input)) return [];
  const at = shortSha(head);
  const state = (id: string) =>
    verdict.conditions.find((entry) => entry.id === id)?.state;
  // A draft or a held PR is the author's or the owner's to move.
  if (state("draft") === "unmet" || state("hold") === "unmet") return [];
  const make = (
    kind: ActionKind,
    target: string,
    text: string,
    extra: { since?: string; key?: string } = {},
  ): Action => ({
    key: `${pr}:${head}:${kind}:${target}${extra.key ? `:${extra.key}` : ""}`,
    pr,
    head,
    kind,
    target,
    text,
    ...(extra.since ? { since: extra.since } : {}),
  });
  if (verdict.state === "READY")
    return [
      make(
        "ready",
        "owner",
        `READY #${pr} at ${at}: ${input.item?.title ?? ""}`.trim(),
      ),
    ];

  const actions: Action[] = [];
  const judgments: string[] = [];
  const author = authorOf(pr, input.item?.branch, settings, seats);
  const toAuthor = (kind: ActionKind, text: string, cause?: string) => {
    if (author)
      actions.push(
        make(
          kind,
          author,
          `[crew -> ${author}] ${text}`,
          cause ? { key: digest(cause) } : {},
        ),
      );
    else
      judgments.push(
        `no author seat for ${input.item?.branch ?? "an unknown branch"}: ${text}`,
      );
  };

  const reviewers = input.item?.pr?.reviewers ?? [];
  const fixes: string[] = [];
  const runs: { name: string; since?: string }[] = [];
  for (const entry of verdict.conditions) {
    if (!entry.id.startsWith("review:") || entry.state === "met") continue;
    const name = entry.id.slice(7);
    const claim = reviewers.find((candidate) => candidate.reviewer === name);
    if (!claim) runs.push({ name });
    else if (claim.outcome === "open" && claim.commit === head)
      fixes.push(`${name} ${claim.url}`);
    else if (claim.outcome === "unknown" || !claim.commit)
      judgments.push(`can't read ${name}'s RESULT: ${claim.url}`);
    else runs.push({ name, since: claim.commit });
  }
  // One fix pass: the author hears once every required reviewer has posted
  // on this head, not after the first.
  if (fixes.length && !runs.length)
    toAuthor(
      "fix",
      `ACT #${pr} fix @${at}: findings from ${fixes.join(", ")}. Fix every finding in one pass, push, then reply on the PR signed by your seat with one line per finding naming its ID or exact file:line and fixing commit. The next round waits for every reply and 10 minutes without a push.`,
    );
  const failing = verdict.conditions.find(
    (entry) => entry.id === "checks" && entry.state === "unmet",
  );
  // An attempt a rerun replaced neither holds the author back nor names
  // the failure.
  const checks = currentChecks(input);
  // A run still going may replace the failure, as when a new push or label
  // cancels the run whose roll-up failed; the author hears once it settles.
  const settled = !checks.some((check) => check.state === "pending");
  // Keyed by the failed jobs, so a rerun that fails again tells the author.
  const failedJobs = checks
    .filter((check) => check.state === "fail")
    .map((check) => check.url ?? check.name)
    .sort()
    .join(" ");
  if (failing && settled)
    toAuthor(
      "ci",
      `ACT #${pr} ci @${at}: ${failing.detail}. Rerun a listed flake once with gh run rerun <id> --failed; otherwise fix and push.`,
      failedJobs || failing.detail,
    );
  // A check that never finishes holds every review back; keyed by its job,
  // so a rerun that sticks again is heard again.
  for (const check of running) {
    if (check.minutes < settings.stallMinutes) continue;
    const job = /\/job\/(\d+)/u.exec(check.url)?.[1];
    toAuthor(
      "ci",
      // No minute count in the text: without an author it is an owner
      // notice keyed by its text, which must stay the same every pass.
      `ACT #${pr} ci @${at}: ${check.name} has been running over ${settings.stallMinutes} minutes, longer than CI takes; GitHub may have lost its status. Rerun it: ${job ? `gh run rerun --job ${job}` : check.url}`,
      check.url,
    );
  }
  if (state("mergeable") === "unmet")
    toAuthor(
      "conflict",
      `ACT #${pr} conflict @${at}: merge origin/main, resolve, run the queued gate and push, then post a one-line resolution note on the PR.`,
    );
  if (state("screenshots") === "unmet")
    toAuthor(
      "screenshots",
      `ACT #${pr} screenshots @${at}: add captures for the five owner viewports to the PR.`,
    );

  // Reviewers read the diff, not CI, so they start as soon as a head is
  // pushed, in parallel with its checks; READY still needs both. A head
  // GitHub can't merge yet would only be reviewed again after the merge.
  const reviewable = state("mergeable") === "met";
  if (reviewable)
    for (const run of runs) {
      const model = settings.roster[run.name];
      if (!model) {
        judgments.push(`${run.name} has no roster model to run on`);
        continue;
      }
      if (!harnessOf(model)) {
        judgments.push(
          `${run.name}'s roster model ${model.model} is neither a Claude nor a Codex model`,
        );
        continue;
      }
      actions.push(
        run.since
          ? make(
              "confirm",
              run.name,
              `${run.name} confirms #${pr} @${at} since ${shortSha(run.since)}`,
              { since: run.since },
            )
          : make("review", run.name, `${run.name} reviews #${pr} @${at}`),
      );
    }

  for (const entry of verdict.conditions)
    if (entry.state === "judgment") judgments.push(entry.detail);
  // One notice per distinct judgment, so a later one on the same head is heard.
  for (const judgment of judgments)
    actions.push(
      make("judgment", "owner", `NEEDS-OWNER #${pr} at ${at}: ${judgment}`, {
        key: digest(judgment),
      }),
    );
  return actions;
}

/** The crew settings from the gate config: `crew`, over the shared roster. */
export function loadSettings(path: string): CrewSettings {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    crew?: Partial<CrewSettings>;
    roster?: CrewSettings["roster"];
  };
  return {
    ...SETTINGS_DEFAULTS,
    ...raw.crew,
    roster: { ...raw.roster, ...raw.crew?.roster },
  };
}
