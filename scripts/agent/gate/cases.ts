import type { PullRequestCheck } from "../../../shared/pullRequests";
import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../shared/pullRequestFreshness";
import type { WorkItem } from "../../../shared/worldSources";
import { reviewerResults } from "../../../server/src/sources/pullRequestDetail";
import {
  fullOutcomes,
  latestChecks,
  type CheckAttempt,
  type CopyResult,
  type Execution,
  type GateConfig,
  type GateInput,
  type VerdictState,
} from "./predicate";

/**
 * Synthetic acceptance cases shaped like the crew's real incidents. Reviewer
 * evidence is written as RESULT posts and read by World's own parser, so a
 * case exercises the same claim reading as the PR card.
 */

export const NOW = Date.parse("2026-01-02T12:00:00Z");
export const SHA = {
  reviewed: "a".repeat(40),
  fixed: "b".repeat(40),
  merged: "c".repeat(40),
  other: "d".repeat(40),
};
const NUMBER = 7;
const TRIO = ["rev2", "rev-astra", "rev-opus"];

export const config: GateConfig = {
  repo: "example-org/widgets",
  reviewers: { default: TRIO },
  flakes: ["Browser tests"],
  rerunBudget: 1,
};

export type Post = { reviewer: string | null; commit: string; result: string };

export function result(post: Post) {
  const header = post.reviewer
    ? `Reviewer: ${post.reviewer}\nReviewed commit: ${post.commit}\n`
    : "";
  return `${header}RESULT #${NUMBER}: ${post.result}`;
}

/** `confirm("rev2", head)`: the canonical clean confirmation. */
export const confirm = (reviewer: string, commit: string): Post => ({
  reviewer,
  commit,
  result: "2/2 resolved, 0 new",
});

const GREEN: PullRequestCheck[] = [
  { name: "Delivery checks", state: "pass", required: true },
  { name: "Browser tests", state: "pass", required: false },
];

export function input(options: {
  head: string;
  posts: Post[];
  commits?: string[];
  copies?: Record<string, CopyResult>;
  attempts?: CheckAttempt[];
  checks?: PullRequestCheck[];
  item?: Partial<WorkItem>;
  hold?: GateInput["hold"];
  labels?: string[];
  state?: GateInput["state"];
  overlap?: string[];
  requiredChecks?: string[] | null;
  historyComplete?: boolean;
  waived?: string[];
  truncated?: boolean;
  executions?: Record<string, Execution>;
}): GateInput {
  const commits = (options.commits ?? [SHA.reviewed, options.head]).map(
    (oid, index) => ({
      oid,
      at: index + 1,
    }),
  );
  const posts = options.posts.map((post, index) => ({
    id: `post-${index + 1}`,
    url: `https://github.com/example-org/widgets/pull/${NUMBER}#issuecomment-${index + 1}`,
    body: result(post),
    at: NOW - 60_000 * (options.posts.length - index),
  }));
  const checks = options.checks ?? GREEN;
  const executions = options.executions ?? {};
  const latest = latestChecks(checks, executions).latest;
  const state = latest.some((check) => check.state === "fail")
    ? "fail"
    : latest.some((check) => check.state === "pending")
      ? "pending"
      : "pass";
  const item: WorkItem = {
    key: `github:pr:example-org/widgets#${NUMBER}`,
    source: "github",
    kind: "pull_request",
    ref: `example-org/widgets#${NUMBER}`,
    title: "Synthetic batch",
    url: `https://github.com/example-org/widgets/pull/${NUMBER}`,
    lane: "review",
    status: "open",
    roles: ["author"],
    updatedAt: NOW,
    number: NUMBER,
    repo: "example-org/widgets",
    draft: false,
    checks: state,
    review: "none",
    mergeable: "mergeable",
    base: "main",
    headSha: options.head,
    pr: {
      baseRef: "main",
      behindBy: 3,
      checks,
      checksTruncated: options.truncated ?? false,
      reviewers: reviewerResults(NUMBER, posts, commits, options.head),
      uiChange: false,
      images: 0,
    },
    prObservation: {
      source: "github",
      state: "fresh",
      headSha: options.head,
      readAt: NOW,
      expiresAt: NOW + PULL_REQUEST_DETAIL_MAX_AGE_MS,
    },
    ...options.item,
  };
  return {
    number: NUMBER,
    state: options.state ?? "OPEN",
    labels: options.labels ?? ["pod:town"],
    item,
    history: posts.flatMap((post) =>
      reviewerResults(NUMBER, [post], commits, options.head),
    ),
    historyComplete: options.historyComplete ?? true,
    requiredChecks:
      options.requiredChecks === undefined
        ? ["Delivery checks"]
        : options.requiredChecks,
    attempts: options.attempts ?? [],
    executions,
    copies: options.copies ?? {},
    hold: options.hold ?? null,
    waived: options.waived ?? [],
    outcomes: fullOutcomes(NUMBER, posts),
    overlap: options.overlap ?? [],
    readAt: NOW,
  };
}

export type Case = {
  name: string;
  now: number;
  config?: GateConfig;
  input: GateInput;
  expect: { state: VerdictState; conditions?: Record<string, string> };
};

/** An Actions job details URL. */
const job = (id: number) =>
  `https://github.com/example-org/widgets/actions/runs/${id}/job/${id}`;
/** Job ID → its run number and attempt in one workflow. */
const runs = (entries: Record<number, [number, number]>) =>
  Object.fromEntries(
    Object.entries(entries).map(([id, [runNumber, attempt]]) => [
      id,
      { runId: 1000 + runNumber, workflowId: 9, runNumber, attempt },
    ]),
  );

/** The crew's roll-up job named as an aggregate. */
const aggregates: GateConfig = {
  ...config,
  aggregateChecks: ["Delivery checks"],
};

const allConfirm = (head: string) =>
  TRIO.map((reviewer) => confirm(reviewer, head));
const attempt = (name: string, conclusion = "failure"): CheckAttempt => ({
  runId: 11,
  attempt: 1,
  name,
  conclusion,
  completedAt: NOW - 600_000,
});

export const CASES: Case[] = [
  {
    name: "trio confirmed on the head is READY",
    now: NOW,
    input: input({ head: SHA.fixed, posts: allConfirm(SHA.fixed) }),
    expect: { state: "READY" },
  },
  {
    // #384: the repaired head lacked one reviewer's confirmation.
    name: "A1 missing confirmation on the repaired head",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        confirm("rev-opus", SHA.reviewed),
        confirm("rev2", SHA.fixed),
        confirm("rev-astra", SHA.fixed),
      ],
      copies: {
        [SHA.reviewed]: {
          kind: "outdated",
          detail: "bbbbbbb is not a merge of main",
        },
      },
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev-opus": "unmet" } },
  },
  {
    // #333: merged with accepted P2s still open.
    name: "A2 open findings from a required reviewer",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        confirm("rev2", SHA.fixed),
        confirm("rev-astra", SHA.fixed),
        {
          reviewer: "rev-opus",
          commit: SHA.fixed,
          result: "1/3 resolved, 2 new",
        },
      ],
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev-opus": "unmet" } },
  },
  {
    name: "A2b open findings from a reviewer outside the required set",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        ...allConfirm(SHA.fixed),
        { reviewer: "rev5", commit: SHA.fixed, result: "0/1 resolved, 1 new" },
      ],
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev5": "unmet" } },
  },
  {
    name: "A3 behind main with an unchanged head stays READY",
    now: NOW,
    input: input({ head: SHA.fixed, posts: allConfirm(SHA.fixed) }),
    expect: { state: "READY" },
  },
  {
    name: "A3b claims carry across a clean main merge",
    now: NOW,
    input: input({
      head: SHA.merged,
      commits: [SHA.fixed, SHA.merged],
      posts: allConfirm(SHA.fixed),
      copies: { [SHA.fixed]: { kind: "clean-merge" } },
    }),
    expect: { state: "READY", conditions: { "review:rev2": "met" } },
  },
  {
    name: "A3c a resolved conflict needs confirmation",
    now: NOW,
    input: input({
      head: SHA.merged,
      commits: [SHA.fixed, SHA.merged],
      posts: allConfirm(SHA.fixed),
      copies: {
        [SHA.fixed]: {
          kind: "conflict",
          detail: "ccccccc resolved a conflict",
        },
      },
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev-astra": "unmet" } },
  },
  {
    name: "A3d overlap with main is information, not a blocker",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      overlap: ["web/src/world/town/TownCanvas.tsx"],
    }),
    expect: { state: "READY" },
  },
  {
    name: "A4 a known flake green on rerun stays READY with the failure retained",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [attempt("Browser tests")],
    }),
    expect: { state: "READY" },
  },
  {
    name: "A4b a rerun green outside the flake list needs judgment",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [attempt("Delivery checks")],
    }),
    expect: { state: "NEEDS_JUDGMENT", conditions: { rerun: "judgment" } },
  },
  {
    name: "A4c a flake rerun over budget needs judgment",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        attempt("Browser tests"),
        { ...attempt("Browser tests"), attempt: 2 },
      ],
    }),
    expect: { state: "NEEDS_JUDGMENT", conditions: { rerun: "judgment" } },
  },
  {
    name: "A4d a running rerun is WAITING",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [attempt("Browser tests")],
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        { name: "Browser tests", state: "pending", required: false },
      ],
    }),
    expect: { state: "WAITING", conditions: { checks: "waiting" } },
  },
  {
    name: "A4e a missing required check is UNKNOWN, never failed or READY",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      requiredChecks: ["Delivery checks", "Security scan"],
    }),
    expect: { state: "UNKNOWN", conditions: { required: "unknown" } },
  },
  {
    name: "A4h a later run supersedes a failed one: newest decides, failure retained",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        { name: "Delivery checks", state: "fail", required: true, url: job(1) },
        { name: "Delivery checks", state: "pass", required: true, url: job(3) },
        { name: "Browser tests", state: "fail", required: false, url: job(2) },
        { name: "Browser tests", state: "pass", required: false, url: job(4) },
      ],
      executions: runs({ 1: [1, 1], 2: [1, 1], 3: [2, 1], 4: [2, 1] }),
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { checks: "met", rerun: "judgment" },
    },
  },
  {
    name: "A4i a running rerun after a failure is WAITING, not failed",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        {
          name: "Delivery checks",
          state: "pass",
          required: true,
          url: job(10),
        },
        { name: "Browser tests", state: "fail", required: false, url: job(11) },
        {
          name: "Browser tests",
          state: "pending",
          required: false,
          url: job(12),
        },
      ],
      executions: runs({ 11: [1, 1], 12: [1, 2] }),
    }),
    expect: { state: "WAITING", conditions: { checks: "waiting" } },
  },
  {
    // An older run's dependent job can be queued after a newer rerun's job.
    name: "A4j a newer execution's failure beats an older run's later-queued pass",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        {
          name: "Delivery checks",
          state: "pass",
          required: true,
          url: job(10),
        },
        {
          name: "Browser tests",
          state: "pass",
          required: false,
          url: job(20),
          completedAt: NOW - 1000,
        },
        {
          name: "Browser tests",
          state: "fail",
          required: false,
          url: job(15),
          completedAt: NOW - 2000,
        },
      ],
      executions: runs({ 20: [1, 1], 15: [2, 1] }),
    }),
    expect: { state: "NOT_READY", conditions: { checks: "unmet" } },
  },
  {
    name: "A4k an older run still pending does not hide a newer green run",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        {
          name: "Delivery checks",
          state: "pass",
          required: true,
          url: job(10),
        },
        {
          name: "Browser tests",
          state: "pending",
          required: false,
          url: job(30),
        },
        { name: "Browser tests", state: "pass", required: false, url: job(12) },
      ],
      executions: runs({ 30: [1, 1], 12: [1, 2] }),
    }),
    expect: { state: "READY", conditions: { checks: "met" } },
  },
  {
    name: "A4l repeated runs without a known execution are unordered: worst stands, UNKNOWN",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        {
          name: "Delivery checks",
          state: "pass",
          required: true,
          url: job(10),
        },
        { name: "Browser tests", state: "fail", required: false, url: job(11) },
        { name: "Browser tests", state: "pass", required: false, url: job(12) },
      ],
      executions: runs({ 12: [2, 1] }),
    }),
    expect: {
      state: "NOT_READY",
      conditions: { checks: "unmet", "checks-order": "unknown" },
    },
  },
  {
    name: "A4m repeated runs from different workflows are unordered",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        {
          name: "Delivery checks",
          state: "pass",
          required: true,
          url: job(10),
        },
        { name: "Browser tests", state: "pass", required: false, url: job(11) },
        { name: "Browser tests", state: "pass", required: false, url: job(12) },
      ],
      executions: {
        11: { runId: 1001, workflowId: 9, runNumber: 1, attempt: 1 },
        12: { runId: 2007, workflowId: 8, runNumber: 7, attempt: 1 },
      },
    }),
    expect: { state: "UNKNOWN", conditions: { "checks-order": "unknown" } },
  },
  {
    name: "A4n a failed attempt reported twice counts once",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        {
          name: "Delivery checks",
          state: "pass",
          required: true,
          url: job(10),
        },
        { name: "Browser tests", state: "fail", required: false, url: job(11) },
        { name: "Browser tests", state: "pass", required: false, url: job(12) },
      ],
      executions: runs({ 11: [1, 1], 12: [1, 2] }),
      attempts: [{ ...attempt("Browser tests"), jobId: 11 }],
    }),
    expect: { state: "READY" },
  },
  {
    name: "A4o a named aggregate that failed only with a listed flake is excused",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        { ...attempt("Browser tests"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
      ],
    }),
    expect: { state: "READY" },
  },
  {
    name: "A4p a named aggregate that failed beside a non-flake needs judgment",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [...GREEN, { name: "Lint", state: "pass", required: false }],
      attempts: [
        { ...attempt("Lint"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { rerun: "judgment", aggregate: "judgment" },
    },
  },
  {
    name: "A4q a named aggregate that failed alone needs judgment",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [{ ...attempt("Delivery checks"), jobId: 102 }],
    }),
    expect: { state: "NEEDS_JUDGMENT", conditions: { aggregate: "judgment" } },
  },
  {
    name: "A4r an aggregate is never inferred: unnamed, it needs judgment",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        { ...attempt("Browser tests"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
      ],
    }),
    expect: { state: "NEEDS_JUDGMENT", conditions: { rerun: "judgment" } },
  },
  {
    name: "A4s a flake over budget in the same attempt does not excuse the aggregate",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        { ...attempt("Browser tests"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
        { ...attempt("Browser tests"), attempt: 2, jobId: 103 },
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { rerun: "judgment", aggregate: "judgment" },
    },
  },
  {
    name: "A4t a flake in a different run attempt does not excuse the aggregate",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        { ...attempt("Browser tests"), jobId: 101 },
        { ...attempt("Delivery checks"), runId: 12, jobId: 102 },
      ],
    }),
    expect: { state: "NEEDS_JUDGMENT", conditions: { aggregate: "judgment" } },
  },
  {
    // rev2 and rev-astra: a flake that was skipped, not recovered, can't excuse.
    name: "A4u a flake skipped rather than recovered does not excuse the aggregate",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        { name: "Browser tests", state: "skipped", required: false },
      ],
      attempts: [
        { ...attempt("Browser tests"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { aggregate: "judgment" },
    },
  },
  {
    // Only the aggregate rule can block: the non-flake peer has no green run.
    name: "A4v a non-flake peer that never went green keeps the aggregate judged",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        { ...attempt("Lint"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { aggregate: "judgment" },
    },
  },
  {
    name: "A4w superseded check runs from one attempt excuse the aggregate",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        { name: "Delivery checks", state: "fail", required: true, url: job(1) },
        { name: "Delivery checks", state: "pass", required: true, url: job(3) },
        { name: "Browser tests", state: "fail", required: false, url: job(2) },
        { name: "Browser tests", state: "pass", required: false, url: job(4) },
      ],
      executions: runs({ 1: [1, 1], 2: [1, 1], 3: [1, 2], 4: [1, 2] }),
    }),
    expect: { state: "READY" },
  },
  {
    name: "A4x superseded runs from different attempts do not excuse the aggregate",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        { name: "Delivery checks", state: "fail", required: true, url: job(1) },
        { name: "Delivery checks", state: "pass", required: true, url: job(3) },
        { name: "Browser tests", state: "fail", required: false, url: job(2) },
        { name: "Browser tests", state: "pass", required: false, url: job(4) },
      ],
      executions: runs({ 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [3, 1] }),
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { aggregate: "judgment" },
    },
  },
  {
    // An unplaced earlier run can't be ordered, so it never reaches the
    // aggregate rule: the worst run stands.
    name: "A4y an aggregate run with no known execution fails closed",
    now: NOW,
    config: aggregates,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      checks: [
        { name: "Delivery checks", state: "fail", required: true, url: job(1) },
        { name: "Delivery checks", state: "pass", required: true, url: job(3) },
      ],
      executions: runs({ 3: [1, 2] }),
    }),
    expect: {
      state: "NOT_READY",
      conditions: { checks: "unmet", "checks-order": "unknown" },
    },
  },
  {
    // The loader refuses this config; a fixture bypassing it still can't let
    // the flake rule excuse an aggregate.
    name: "A4z an aggregate also listed as a flake is still judged as an aggregate",
    now: NOW,
    config: { ...aggregates, flakes: ["Browser tests", "Delivery checks"] },
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      attempts: [
        { ...attempt("Lint"), jobId: 101 },
        { ...attempt("Delivery checks"), jobId: 102 },
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { aggregate: "judgment" },
    },
  },
  {
    name: "A4f an unknown required-check inventory is UNKNOWN",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      requiredChecks: null,
    }),
    expect: { state: "UNKNOWN", conditions: { required: "unknown" } },
  },
  {
    name: "A4g more checks than were read is UNKNOWN",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      truncated: true,
    }),
    expect: { state: "UNKNOWN", conditions: { "checks-read": "unknown" } },
  },
  {
    name: "A5 a merged pull request is MERGED, never READY",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      state: "MERGED",
    }),
    expect: { state: "MERGED" },
  },
  {
    name: "A5b claims on a head replaced by a new commit are outdated",
    now: NOW,
    input: input({
      head: SHA.other,
      commits: [SHA.fixed, SHA.other],
      posts: allConfirm(SHA.fixed),
      copies: {
        [SHA.fixed]: {
          kind: "outdated",
          detail: "ddddddd is not a merge of main",
        },
      },
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev2": "unmet" } },
  },
  {
    // #390: an owner repro withdraws acceptance while CI stays green.
    name: "A6 an owner hold blocks across heads",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      hold: {
        reason: "owner repro: control hidden when expanded",
        at: NOW - 1000,
      },
    }),
    expect: { state: "NOT_READY", conditions: { hold: "unmet" } },
  },
  {
    name: "A7 a draft is not READY",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      item: { draft: true },
    }),
    expect: { state: "NOT_READY", conditions: { draft: "unmet" } },
  },
  {
    name: "A7b a conflicting pull request is not READY",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      item: { mergeable: "conflicting" },
    }),
    expect: { state: "NOT_READY", conditions: { mergeable: "unmet" } },
  },
  {
    name: "A7c GitHub still computing mergeability is UNKNOWN",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      item: { mergeable: "unknown" },
    }),
    expect: { state: "UNKNOWN", conditions: { mergeable: "unknown" } },
  },
  {
    name: "A7d a stale detail read is UNKNOWN",
    now: NOW + PULL_REQUEST_DETAIL_MAX_AGE_MS + 1,
    input: input({ head: SHA.fixed, posts: allConfirm(SHA.fixed) }),
    expect: { state: "UNKNOWN", conditions: { reviewers: "unknown" } },
  },
  {
    name: "A9 an unattributed finding after the trio needs judgment",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        ...allConfirm(SHA.fixed),
        { reviewer: null, commit: SHA.fixed, result: "1 new P2" },
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { unattributed: "judgment" },
    },
  },
  {
    name: "A9c an older unattributed finding still blocks",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        { reviewer: null, commit: SHA.reviewed, result: "1 new P2" },
        ...allConfirm(SHA.fixed),
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { unattributed: "judgment" },
    },
  },
  {
    name: "A9d a waived unattributed finding no longer blocks",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        { reviewer: null, commit: SHA.reviewed, result: "1 new P2" },
        ...allConfirm(SHA.fixed),
      ],
      waived: ["post-1"],
    }),
    expect: { state: "READY" },
  },
  {
    name: "A9e an unattributed finding past the display cut still blocks",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        {
          reviewer: null,
          commit: SHA.fixed,
          result: `confirmed; ${"reviewed checks and expected behavior, ".repeat(6)}1 new P2`,
        },
        ...allConfirm(SHA.fixed),
      ],
    }),
    expect: {
      state: "NEEDS_JUDGMENT",
      conditions: { unattributed: "judgment" },
    },
  },
  {
    name: "A10 a reviewer outside the set closes findings only on a head that counts",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        {
          reviewer: "rev5",
          commit: SHA.reviewed,
          result: "0/1 resolved, 1 new",
        },
        confirm("rev5", SHA.reviewed),
        ...allConfirm(SHA.fixed),
      ],
      copies: {
        [SHA.reviewed]: {
          kind: "outdated",
          detail: "bbbbbbb is not a merge of main",
        },
      },
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev5": "unmet" } },
  },
  {
    name: "A10b a clean extra reviewer at an old head is not an obligation",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [confirm("rev5", SHA.reviewed), ...allConfirm(SHA.fixed)],
      copies: { [SHA.reviewed]: { kind: "outdated" } },
    }),
    expect: { state: "READY" },
  },
  {
    name: "A11 incomplete review history is UNKNOWN",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: allConfirm(SHA.fixed),
      historyComplete: false,
    }),
    expect: { state: "UNKNOWN", conditions: { history: "unknown" } },
  },
  {
    name: "A9b older unattributed RESULT evidence is never counted",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [
        { reviewer: null, commit: SHA.reviewed, result: "0 new" },
        ...allConfirm(SHA.fixed),
      ],
    }),
    expect: { state: "READY" },
  },
  {
    name: "no RESULT from a required reviewer",
    now: NOW,
    input: input({
      head: SHA.fixed,
      posts: [confirm("rev2", SHA.fixed), confirm("rev-astra", SHA.fixed)],
    }),
    expect: { state: "NOT_READY", conditions: { "review:rev-opus": "unmet" } },
  },
  {
    name: "a pod override replaces the default reviewers",
    now: NOW,
    config: {
      ...config,
      reviewers: { default: TRIO, pods: { town: ["rev2", "rev5"] } },
    },
    input: input({
      head: SHA.fixed,
      posts: [confirm("rev2", SHA.fixed), confirm("rev5", SHA.fixed)],
    }),
    expect: { state: "READY" },
  },
  {
    name: "no required reviewers configured is UNKNOWN",
    now: NOW,
    config: { ...config, reviewers: {} },
    input: input({ head: SHA.fixed, posts: allConfirm(SHA.fixed) }),
    expect: { state: "UNKNOWN", conditions: { reviewers: "unknown" } },
  },
];
