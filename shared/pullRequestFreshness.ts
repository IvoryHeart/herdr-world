import type { PullRequestDetailObservation, WorkItem } from "./worldSources";

export const PULL_REQUEST_DETAIL_MAX_AGE_MS = 10 * 60_000;
export const PR_DETAILS_UNAVAILABLE =
  "PR details are stale or unavailable. Refresh Sources and review again.";

export function parsePullRequestDetailObservation(
  value: unknown,
): PullRequestDetailObservation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const entry = value as Record<string, unknown>;
  const timestamp = (value: unknown) =>
    value === null ||
    (Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= 8_640_000_000_000_000);
  if (
    entry.source !== "github" ||
    typeof entry.state !== "string" ||
    !["fresh", "stale", "unavailable"].includes(entry.state) ||
    typeof entry.headSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(entry.headSha) ||
    !timestamp(entry.readAt) ||
    !timestamp(entry.expiresAt) ||
    (entry.readAt === null) !== (entry.expiresAt === null) ||
    (entry.readAt !== null &&
      entry.expiresAt !==
        Number(entry.readAt) + PULL_REQUEST_DETAIL_MAX_AGE_MS) ||
    (entry.state === "fresh" && entry.readAt === null)
  )
    return;
  return {
    source: "github",
    state: entry.state as PullRequestDetailObservation["state"],
    headSha: entry.headSha,
    readAt: entry.readAt as number | null,
    expiresAt: entry.expiresAt as number | null,
  };
}

/** The observing clock may withdraw freshness; it never renews read provenance. */
export function freshPullRequestDetail(item: WorkItem, now = Date.now()) {
  const observation = parsePullRequestDetailObservation(item.prObservation);
  return Boolean(
    item.pr &&
      observation?.source === "github" &&
      observation.state === "fresh" &&
      /^[0-9a-f]{40}$/u.test(observation.headSha) &&
      observation.headSha === item.headSha &&
      observation.readAt !== null &&
      Number.isFinite(observation.readAt) &&
      observation.readAt >= 0 &&
      observation.expiresAt !== null &&
      observation.expiresAt ===
        observation.readAt + PULL_REQUEST_DETAIL_MAX_AGE_MS &&
      Number.isFinite(now) &&
      now >= observation.readAt &&
      now < observation.expiresAt,
  );
}

/** Requalify retained records without changing the time the detail was read. */
export function qualifyPullRequestDetail(
  item: WorkItem,
  now: number,
  sourceReady: boolean,
) {
  if (
    !item.prObservation ||
    item.prObservation.state !== "fresh" ||
    (sourceReady && freshPullRequestDetail(item, now))
  )
    return item;
  return {
    ...item,
    prObservation: {
      ...item.prObservation,
      state: item.pr ? ("stale" as const) : ("unavailable" as const),
    },
  };
}
