import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../../shared/pullRequestFreshness";
import type { WorkItem } from "../../../../shared/worldSources";

/** A complete synthetic detail read, independently timestamped from its list. */
export function fixturePullRequest(
  number: number,
  fields: Partial<WorkItem> = {},
): WorkItem & { headSha: string } {
  const head = String(number % 10).repeat(40);
  const headSha = fields.headSha ?? head;
  const readAt = Date.now();
  return {
    key: `github:pr:example-org/web-app#${number}`,
    source: "github",
    kind: "pull_request",
    ref: `example-org/web-app#${number}`,
    title: `Synthetic card change ${number}`,
    url: `https://github.com/example-org/web-app/pull/${number}`,
    lane: "ready",
    status: "open",
    roles: ["author"],
    updatedAt: 2,
    number,
    repo: "example-org/web-app",
    base: "main",
    draft: false,
    checks: "pass",
    review: "approved",
    mergeable: "mergeable",
    pr: {
      baseRef: "main",
      behindBy: 2,
      checks: [
        { name: "Unit tests", state: "pass", required: true },
        { name: "Browser suite", state: "pass", required: false },
      ],
      checksTruncated: false,
      reviewers: [
        {
          reviewer: "rev2",
          url: `https://github.com/example-org/web-app/pull/${number}#issuecomment-1`,
          at: 1,
          outcome: "confirmed",
          line: "2/2 resolved, 0 new.",
          commit: head,
          commitsSince: 0,
        },
      ],
      uiChange: true,
      images: 5,
    },
    prObservation: {
      source: "github",
      state: "fresh",
      headSha,
      readAt,
      expiresAt: readAt + PULL_REQUEST_DETAIL_MAX_AGE_MS,
    },
    ...fields,
    headSha,
  };
}
