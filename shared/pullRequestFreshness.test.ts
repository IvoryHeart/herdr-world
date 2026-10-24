import { expect, test } from "bun:test";
import {
  freshPullRequestDetail,
  parsePullRequestDetailObservation,
  PULL_REQUEST_DETAIL_MAX_AGE_MS,
} from "./pullRequestFreshness";
import { pullRequestReadiness } from "./pullRequests";
import type { WorkItem } from "./worldSources";

const observation = {
  source: "github",
  state: "fresh",
  headSha: "c".repeat(40),
  readAt: 1000,
  expiresAt: 601000,
} as const;
const item: WorkItem = {
  key: "github:pr:example-org/widgets#7",
  source: "github",
  kind: "pull_request",
  ref: "example-org/widgets#7",
  title: "Synthetic change",
  url: "https://github.com/example-org/widgets/pull/7",
  lane: "ready",
  status: "open",
  roles: ["author"],
  updatedAt: 1000,
  headSha: observation.headSha,
  checks: "pass",
  mergeable: "mergeable",
  prObservation: observation,
  pr: {
    baseRef: "main",
    behindBy: 0,
    checks: [],
    checksTruncated: false,
    reviewers: [
      {
        reviewer: "rev2",
        url: "https://example.com/review",
        at: 1000,
        outcome: "confirmed",
        line: "0/0 resolved, 0 new",
        commit: observation.headSha,
        commitsSince: 0,
      },
    ],
    uiChange: false,
    images: 0,
  },
};

test("missing, stale, mismatched and malformed qualifications never grant detail readiness", () => {
  expect(freshPullRequestDetail(item)).toBe(false);
  expect(pullRequestReadiness(item).some((rule) => rule.state !== "pass")).toBe(
    true,
  );
  expect(freshPullRequestDetail(item, 1000)).toBe(true);
  expect(freshPullRequestDetail(item, observation.expiresAt)).toBe(false);
  expect(freshPullRequestDetail(item, 999)).toBe(false);
  expect(freshPullRequestDetail(item, Number.NaN)).toBe(false);
  for (const prObservation of [
    undefined,
    { ...observation, state: "stale" as const },
    { ...observation, headSha: "d".repeat(40) },
    { ...observation, expiresAt: 9999999 },
  ]) {
    const entry = { ...item, prObservation };
    expect(freshPullRequestDetail(entry)).toBe(false);
    expect(
      pullRequestReadiness(entry)
        .filter((r) => ["findings", "screenshots"].includes(r.id))
        .map((r) => r.state),
    ).toEqual(["unknown", "unknown"]);
  }
  expect(pullRequestReadiness(item, 1000).map((r) => r.state)).toEqual([
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
  ]);
});

test("wire parsing retains only safe qualification and rejects malformed authority", () => {
  expect(
    parsePullRequestDetailObservation({ ...observation, rawError: "private" }),
  ).toEqual(observation);
  for (const value of [
    null,
    {},
    { ...observation, source: "other" },
    { ...observation, state: "connected" },
    { ...observation, headSha: "short" },
    { ...observation, readAt: -1 },
    { ...observation, readAt: null },
    { ...observation, expiresAt: observation.expiresAt + 1 },
    { ...observation, readAt: "1000" },
    { ...observation, expiresAt: Number.NaN },
    {
      ...observation,
      readAt: 9e15,
      expiresAt: 9e15 + PULL_REQUEST_DETAIL_MAX_AGE_MS,
    },
  ])
    expect(parsePullRequestDetailObservation(value)).toBeUndefined();
  expect(
    parsePullRequestDetailObservation({
      ...observation,
      state: "unavailable",
      readAt: null,
      expiresAt: null,
    }),
  ).toMatchObject({ state: "unavailable" });
  expect(observation.expiresAt - observation.readAt).toBe(
    PULL_REQUEST_DETAIL_MAX_AGE_MS,
  );
});
