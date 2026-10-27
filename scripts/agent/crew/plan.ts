import { readFileSync } from "node:fs";
import { shortSha } from "../../../shared/pullRequests";
import type { GateInput, Verdict } from "../gate/predicate";
import { harnessFor } from "./worker";

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
  /** Seat → model; a reviewer runs fresh on its seat's model. */
  roster: Record<string, { model: string; effort?: string }>;
};

export type ActionKind =
  | "fix"
  | "ci"
  | "conflict"
  | "screenshots"
  | "review"
  | "confirm"
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
      `ACT #${pr} fix @${at}: findings from ${fixes.join(", ")}. Fix every finding in one pass, reply on the PR with one line per finding naming its fixing commit, and push. Reviewers rerun by themselves once CI is green; no need to tell anyone.`,
    );
  const failing = verdict.conditions.find(
    (entry) => entry.id === "checks" && entry.state === "unmet",
  );
  // A run still going may replace the failure, as when a new push or label
  // cancels the run whose roll-up failed; the author hears once it settles.
  const settled = !(input.item?.pr?.checks ?? []).some(
    (check) => check.state === "pending",
  );
  // Keyed by the failed jobs, so a rerun that fails again tells the author.
  const failedJobs = (input.item?.pr?.checks ?? [])
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
      `ACT #${pr} ci @${at}: ${check.name} has been running ${check.minutes} minutes, longer than CI takes; GitHub may have lost its status. Rerun it: ${job ? `gh run rerun --job ${job}` : check.url}`,
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

  // Reviewers look at a head CI passed and GitHub knows it can merge: a
  // red or conflicting head would only be reviewed again.
  const reviewable = state("checks") === "met" && state("mergeable") === "met";
  if (reviewable)
    for (const run of runs) {
      const model = settings.roster[run.name];
      if (!model) {
        judgments.push(`${run.name} has no roster model to run on`);
        continue;
      }
      if (!harnessFor(model.model)) {
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
