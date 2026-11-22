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
 *   (one a prerelease), three running Worlds (one stopped reporting). Three
 *   projects with releases, each a lane in Town, and a fourth with none
 *   yet (example-org/notes), which has no lane.
 * - `failing`: main's latest checks failed.
 * - `stale`: GitHub's last refresh failed; the old pipeline stays, labelled.
 * - `limited`: more changes than one read proves; the list is partial.
 * - `off`: GitHub is switched off in Integrations; only running Worlds show.
 * - `empty`: nothing suggested and nothing running yet.
 * - `many`: sixteen projects with releases, more lanes than a town's sea
 *   holds.
 * - `offline`: the first read is `ready`; every later read fails as if
 *   World stopped answering (press "Read GitHub again" to see it at once).
 *
 * Every link is on example.com, so nothing real opens or changes.
 */

export type ShipyardFixtureMode =
  | "ready"
  | "failing"
  | "stale"
  | "limited"
  | "off"
  | "empty"
  | "offline"
  | "many";

const MODES: readonly ShipyardFixtureMode[] = [
  "ready",
  "failing",
  "stale",
  "limited",
  "off",
  "empty",
  "offline",
  "many",
];
const PARAM = "shipyardFixture";
let mode: ShipyardFixtureMode | null | undefined;
/** `offline`: whether the one good pipeline read has been answered. */
let answered = false;

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
  answered = false;
}

/** The fixture's service, when the switch is on. */
export function shipyardFixtureFetch() {
  const current = shipyardFixtureMode();
  if (!current) return null;
  return (input: string | URL | Request) => {
    const url = new URL(String(input), "http://fixture.invalid");
    const now = Date.now();
    const repo = url.searchParams.get("repo");
    if (current === "offline" && answered)
      return Promise.reject(new TypeError("Failed to fetch"));
    if (current === "offline" && repo) answered = true;
    // Echo the repository asked for, so a choice stored earlier still shows.
    const body = repo
      ? shipyardFixtureSnapshot(current, now, repo)
      : shipyardFixtureCatalog(current, now);
    return Promise.resolve(Response.json(body));
  };
}

export const FIXTURE_REPO = "example-org/widgets";
/** Every project the fixture suggests, in its catalog's order. */
export const FIXTURE_REPOS = [
  FIXTURE_REPO,
  "example-org/gadgets",
  "example-org/sprockets",
  "example-org/cogs",
  "example-org/levers",
  "example-org/pulleys",
  "example-org/rivets",
  "example-org/hinges",
  "example-org/gears",
  "example-org/axles",
  "example-org/springs",
  "example-org/bolts",
  "example-org/washers",
  "example-org/ratchets",
  "example-org/flywheels",
  "example-org/bearings",
] as const;
/** A suggested project that has published no release: it gets no lane. */
export const FIXTURE_UNRELEASED = "example-org/notes";
const SITE = `https://example.com/${FIXTURE_REPO}`;
const siteOf = (repo: string) => `https://example.com/${repo}`;
const DAY = 86_400_000;
const sha = (digit: string) => digit.repeat(40);

function release(
  id: number,
  version: string,
  daysAgo: number,
  now: number,
  channel: ShipyardRelease["channel"] = "stable",
  repo: string = FIXTURE_REPO,
): ShipyardRelease {
  return {
    id,
    tag: `v${version}`,
    version,
    name: `v${version}`,
    publishedAt: now - daysAgo * DAY,
    channel,
    url: `${siteOf(repo)}/releases/tag/v${version}`,
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

function pullRequests(
  count: number,
  now: number,
  repo: string = FIXTURE_REPO,
): ShipyardPullRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    number: 120 - index,
    title: TITLES[index % TITLES.length]!,
    mergedAt: now - (index + 1) * 3 * 3_600_000,
    mergeSha: sha(((index + 3) % 10).toString()),
    url: `${siteOf(repo)}/pull/${120 - index}`,
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
    repositories:
      mode === "empty"
        ? []
        : [
            ...FIXTURE_REPOS.slice(
              0,
              mode === "many" ? FIXTURE_REPOS.length : 3,
            ),
            FIXTURE_UNRELEASED,
          ],
    instances: shipyardFixtureInstances(mode, now),
    limits: SHIPYARD_LIMITS,
  };
}

/**
 * Another project's pipeline: its own versions, main's checks and changes
 * waiting, so every lane in Town looks like a different project.
 */
function otherPipeline(
  index: number,
  now: number,
  repo: string,
): ShipyardPipeline {
  const site = siteOf(repo);
  const health = (
    ["pending", "pass", "fail", "pass", "unknown", "pass", "pass"] as const
  )[(index - 1) % 7]!;
  const major = index % 3;
  const minor = 2 + index;
  const releases = [
    release(
      index * 100 + 3,
      `${major}.${minor}.1`,
      2 + index,
      now,
      "stable",
      repo,
    ),
    release(
      index * 100 + 2,
      `${major}.${minor}.0`,
      9 + index,
      now,
      "stable",
      repo,
    ),
    release(
      index * 100 + 1,
      `${major}.${minor - 1}.0`,
      30 + index,
      now,
      "stable",
      repo,
    ),
  ].slice(0, index % 4 === 3 ? 1 : 3);
  if (index % 2 === 1)
    releases.unshift(
      release(
        index * 100 + 4,
        `${major}.${minor + 1}.0-beta.1`,
        1,
        now,
        "prerelease",
        repo,
      ),
    );
  const baseline = releases.find((entry) => entry.channel === "stable")!;
  const waiting = (index * 3) % 5;
  return {
    repo,
    main: {
      branch: "main",
      sha: sha("4"),
      health,
      workflows: { items: [], complete: true, detail: null },
      url: `${site}/actions?query=branch%3Amain`,
    },
    releases: { items: releases, complete: true, detail: null },
    tags: { items: [], complete: true, detail: null },
    waiting: {
      state: "ready",
      baseline: {
        releaseId: baseline.id,
        tag: baseline.tag,
        sha: sha("8"),
        channel: "stable",
      },
      mainSha: sha("4"),
      aheadBy: waiting,
      commits: Array.from({ length: waiting }, (_, i) =>
        sha(((i + 5) % 10).toString()),
      ),
      pullRequests: pullRequests(waiting, now, repo),
      complete: true,
      detail: null,
      compareUrl: `${site}/compare/${baseline.tag}...main`,
      pullRequestsUrl: `${site}/pulls?q=is%3Apr+is%3Amerged+base%3Amain`,
    },
  };
}

/** A project with main's checks and changes, but no release published yet. */
function unreleasedPipeline(repo: string): ShipyardPipeline {
  const site = siteOf(repo);
  return {
    repo,
    main: {
      branch: "main",
      sha: sha("6"),
      health: "pass",
      workflows: { items: [], complete: true, detail: null },
      url: `${site}/actions?query=branch%3Amain`,
    },
    releases: { items: [], complete: true, detail: null },
    tags: { items: [], complete: true, detail: null },
    waiting: {
      state: "no_baseline",
      baseline: null,
      mainSha: sha("6"),
      aheadBy: null,
      commits: [],
      pullRequests: [],
      complete: false,
      detail: "No release published yet.",
      compareUrl: null,
      pullRequestsUrl: `${site}/pulls?q=is%3Apr+is%3Amerged+base%3Amain`,
    },
  };
}

function pipeline(
  mode: ShipyardFixtureMode,
  now: number,
  repo: string = FIXTURE_REPO,
): ShipyardPipeline {
  const index = FIXTURE_REPOS.indexOf(repo as (typeof FIXTURE_REPOS)[number]);
  if (repo === FIXTURE_UNRELEASED) return unreleasedPipeline(repo);
  if (index > 0) return otherPipeline(index, now, repo);
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
      data: { ...pipeline(mode, now - 42 * 60_000, repo), repo },
    };
  return {
    ...base,
    state: "fresh",
    detail: "GitHub release pipeline observed. Section limits apply.",
    checkedAt: now,
    lastSuccessAt: now,
    data: { ...pipeline(mode, now, repo), repo },
  };
}
