import {
  SHIPYARD_LIMITS,
  type ShipyardCatalog,
  type ShipyardInstance,
  type ShipyardPipeline,
  type ShipyardPullRequest,
  type ShipyardRelease,
  type ShipyardSnapshot,
  type ShipyardWindow,
} from "../../../../shared/shipyard";

/**
 * A testing-only switch for the Shipyard (#1028): open World with
 * `?shipyardFixture` and Town's harbour and the Work lens's Releases tab
 * show a synthetic pipeline instead of World's Shipyard API, until the page
 * reloads. The page drops the parameter at once. Values:
 *
 * - (none) or `ready`: passing main, four changes waiting, five releases
 *   (one a prerelease), three running Worlds (one stopped reporting).
 * - `failing`: main's latest checks failed.
 * - `stale`: GitHub's last refresh failed; the old pipeline stays, labelled.
 * - `limited`: more changes than one read proves; the list is partial.
 * - `off`: GitHub is switched off in Integrations; only running Worlds show.
 * - `empty`: nothing suggested and nothing running yet.
 *
 * Every link is on example.com, so nothing real opens or changes.
 */

export type ShipyardFixtureMode =
  | "ready"
  | "failing"
  | "stale"
  | "limited"
  | "off"
  | "empty";

const MODES: readonly ShipyardFixtureMode[] = [
  "ready",
  "failing",
  "stale",
  "limited",
  "off",
  "empty",
];
const PARAM = "shipyardFixture";
let mode: ShipyardFixtureMode | null | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function shipyardFixtureMode(): ShipyardFixtureMode | null {
  if (mode !== undefined) return mode;
  mode = null;
  if (typeof location === "undefined") return mode;
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM);
  if (value === null) return mode;
  mode = (MODES as readonly string[]).includes(value)
    ? (value as ShipyardFixtureMode)
    : "ready";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return mode;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetShipyardFixture() {
  mode = undefined;
}

/** The fixture's service, when the switch is on. */
export function shipyardFixtureFetch() {
  const current = shipyardFixtureMode();
  if (!current) return null;
  return (input: string | URL | Request) => {
    const url = new URL(String(input), "http://fixture.invalid");
    const now = Date.now();
    const repo = url.searchParams.get("repo");
    // Echo the repository asked for, so a choice stored earlier still shows.
    const body = repo
      ? shipyardFixtureSnapshot(current, now, repo)
      : shipyardFixtureCatalog(current, now);
    return Promise.resolve(Response.json(body));
  };
}

export const FIXTURE_REPO = "example-org/widgets";
const SITE = `https://example.com/${FIXTURE_REPO}`;
const DAY = 86_400_000;
const sha = (digit: string) => digit.repeat(40);

function release(
  id: number,
  version: string,
  daysAgo: number,
  now: number,
  channel: ShipyardRelease["channel"] = "stable",
): ShipyardRelease {
  return {
    id,
    tag: `v${version}`,
    version,
    name: `v${version}`,
    publishedAt: now - daysAgo * DAY,
    channel,
    url: `${SITE}/releases/tag/v${version}`,
  };
}

const TITLES = [
  "Harbour lights for the release pipeline",
  "Keep the Work lens open across views",
  "Faster Town bake on large boards",
  "Fix the phone Back button in Chat",
  "Name the second preview's port",
  "Retry a stalled agent start once",
];

function pullRequests(count: number, now: number): ShipyardPullRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    number: 120 - index,
    title: TITLES[index % TITLES.length]!,
    mergedAt: now - (index + 1) * 3 * 3_600_000,
    mergeSha: sha(((index + 3) % 10).toString()),
    url: `${SITE}/pull/${120 - index}`,
  }));
}

export function shipyardFixtureInstances(
  mode: ShipyardFixtureMode,
  now: number,
): ShipyardWindow<ShipyardInstance> {
  if (mode === "empty") return { items: [], complete: true, detail: null };
  const common = {
    generation: "11111111-1111-4111-8111-111111111111",
    repo: FIXTURE_REPO,
    startedAt: now - 3 * 3_600_000,
    reportedAt: now,
    expiresAt: now + SHIPYARD_LIMITS.instanceLeaseMs,
    state: "fresh" as const,
  };
  return {
    complete: true,
    detail: null,
    items: [
      {
        ...common,
        id: "a".repeat(24),
        version: "1.4.0",
        branch: null,
        sha: null,
        kind: "installed",
        port: 19190,
        openUrl: "http://127.0.0.1:19190/",
        releaseId: 5,
      },
      {
        ...common,
        id: "b".repeat(24),
        version: "1.5.0-dev",
        branch: "main",
        sha: sha("1"),
        kind: "source",
        port: 19191,
        openUrl: "http://127.0.0.1:19191/",
        releaseId: null,
      },
      {
        ...common,
        id: "c".repeat(24),
        version: "1.5.0-dev",
        branch: "preview/harbour-lights",
        sha: sha("2"),
        kind: "source",
        port: 19192,
        reportedAt: now - 2 * 60_000,
        expiresAt: now - 75_000,
        state: "stale",
        openUrl: null,
        releaseId: null,
      },
    ],
  };
}

export function shipyardFixtureCatalog(
  mode: ShipyardFixtureMode,
  now: number,
): ShipyardCatalog {
  return {
    observedAt: now,
    repositories: mode === "empty" ? [] : [FIXTURE_REPO, "example-org/gadgets"],
    instances: shipyardFixtureInstances(mode, now),
    limits: SHIPYARD_LIMITS,
  };
}

function pipeline(mode: ShipyardFixtureMode, now: number): ShipyardPipeline {
  const waiting = mode === "limited" ? 6 : 4;
  const failing = mode === "failing";
  const releases = [
    release(6, "1.5.0-rc.1", 1, now, "prerelease"),
    release(5, "1.4.0", 6, now),
    release(4, "1.3.2", 20, now),
    release(3, "1.3.1", 27, now),
    release(2, "1.3.0", 41, now),
  ];
  const workflow = (
    id: number,
    name: string,
    conclusion: string | null,
    status = "completed",
  ) => ({
    id,
    workflowId: id,
    name,
    sha: sha("1"),
    status,
    conclusion,
    updatedAt: now - 20 * 60_000,
    url: `${SITE}/actions/runs/${id}`,
  });
  return {
    repo: FIXTURE_REPO,
    main: {
      branch: "main",
      sha: sha("1"),
      health: failing ? "fail" : "pass",
      workflows: {
        items: [
          workflow(71, "Checks", failing ? "failure" : "success"),
          workflow(72, "Browser acceptance", "success"),
          workflow(73, "Pages", "success"),
        ],
        complete: true,
        detail: null,
      },
      url: `${SITE}/actions?query=branch%3Amain`,
    },
    releases: { items: releases, complete: true, detail: null },
    tags: {
      items: releases.map((entry) => ({
        name: entry.tag,
        sha: sha("9"),
        url: `${SITE}/tree/${entry.tag}`,
      })),
      complete: true,
      detail: null,
    },
    waiting: {
      state: mode === "limited" ? "limited" : "ready",
      baseline: {
        releaseId: 5,
        tag: "v1.4.0",
        sha: sha("9"),
        channel: "stable",
      },
      mainSha: sha("1"),
      aheadBy: mode === "limited" ? 201 : waiting + 1,
      commits: Array.from({ length: waiting + 1 }, (_, i) =>
        sha(((i + 3) % 10).toString()),
      ),
      pullRequests: pullRequests(waiting, now),
      complete: mode !== "limited",
      detail:
        mode === "limited"
          ? "Only the first 200 commits were compared; more changes may be waiting."
          : null,
      compareUrl: `${SITE}/compare/v1.4.0...main`,
      pullRequestsUrl: `${SITE}/pulls?q=is%3Apr+is%3Amerged+base%3Amain`,
    },
  };
}

export function shipyardFixtureSnapshot(
  mode: ShipyardFixtureMode,
  now: number,
  repo = FIXTURE_REPO,
): ShipyardSnapshot {
  const base = {
    observedAt: now,
    repo,
    source: "github" as const,
    refreshing: false,
    retryAfterMs: SHIPYARD_LIMITS.forcedRefreshMs,
    instances: shipyardFixtureInstances(mode, now),
    limits: SHIPYARD_LIMITS,
  };
  if (mode === "off")
    return {
      ...base,
      state: "disabled",
      detail: "GitHub is switched off in Sources.",
      checkedAt: null,
      lastSuccessAt: null,
      data: null,
    };
  if (mode === "stale")
    return {
      ...base,
      state: "stale",
      detail: "GitHub could not be reached; showing the last good read.",
      checkedAt: now - 30_000,
      lastSuccessAt: now - 42 * 60_000,
      data: { ...pipeline(mode, now - 42 * 60_000), repo },
    };
  return {
    ...base,
    state: "fresh",
    detail: "GitHub release pipeline observed. Section limits apply.",
    checkedAt: now,
    lastSuccessAt: now,
    data: { ...pipeline(mode, now), repo },
  };
}
