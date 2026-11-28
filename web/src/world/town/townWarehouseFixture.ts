import { clock } from "../../clock";
import { useEffect, useState } from "react";
import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../../shared/pullRequestFreshness";
import type {
  WorkItem,
  WorldSourcesSnapshot,
  WorldSourceStatus,
} from "../../../../shared/worldSources";
import { useWorldSources } from "../worldSources";

/**
 * A testing-only switch for the warehouse (#760): open World with
 * `?townWarehouseFixture` and Town's warehouse shows synthetic pull requests in
 * every state instead of the GitHub source's, until the page reloads. The
 * page drops the parameter at once. Ten seconds after it loads, the first
 * ready parcel is merged, to show it leave. `?townWarehouseFixture=many` adds a
 * pile beyond the yard; `?townWarehouseFixture=off` shows a signed-out source.
 *
 * Only the warehouse and the Work lens it opens read it; Board's Work
 * lens and every other view keep the real source.
 * Its pull requests are on example.com repositories World never has, so the
 * service refuses any action on them.
 */

export type TownWarehouseFixtureMode = "pile" | "many" | "off";

const PARAM = "townWarehouseFixture";
let mode: TownWarehouseFixtureMode | null | undefined;
/** When the page first read the fixture; every reader shares it. */
let fixtureStart: number | null = null;

/** The switch, read once per page load; the parameter is removed. */
export function townWarehouseFixtureMode(): TownWarehouseFixtureMode | null {
  if (mode !== undefined) return mode;
  mode = null;
  if (typeof location === "undefined") return mode;
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM);
  if (value === null) return mode;
  mode = value === "many" || value === "off" ? value : "pile";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return mode;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetTownWarehouseFixture() {
  mode = undefined;
  fixtureStart = null;
}

const REPO = "example-org/web-app";

function pr(
  number: number,
  now: number,
  fields: Partial<WorkItem> & { fresh?: boolean },
): WorkItem {
  const headSha = (number % 16).toString(16).repeat(40);
  const { fresh = true, ...rest } = fields;
  const readAt = fresh ? now : now - 2 * PULL_REQUEST_DETAIL_MAX_AGE_MS;
  const repo = rest.repo ?? REPO;
  return {
    key: `github:pr:${repo}#${number}`,
    source: "github",
    kind: "pull_request",
    ref: `${repo}#${number}`,
    title: `Synthetic change ${number}`,
    url: `https://example.com/${repo}/pull/${number}`,
    lane: "ready",
    status: "open",
    roles: ["author"],
    updatedAt: now - number * 60_000,
    number,
    repo,
    base: "main",
    draft: false,
    checks: "pass",
    review: "approved",
    mergeable: "mergeable",
    headSha,
    pr: {
      baseRef: "main",
      behindBy: 0,
      checks: [{ name: "Unit tests", state: "pass", required: true }],
      checksTruncated: false,
      reviewers: [
        {
          reviewer: "rev-example",
          url: `https://example.com/${repo}/pull/${number}#review`,
          at: now - 60_000,
          outcome: "confirmed",
          line: "RESULT: all findings confirmed",
          commit: headSha,
          commitsSince: 0,
        },
      ],
      uiChange: false,
      images: 0,
    },
    prObservation: {
      source: "github",
      state: fresh ? "fresh" : "stale",
      headSha,
      readAt,
      expiresAt: readAt + PULL_REQUEST_DETAIL_MAX_AGE_MS,
    },
    ...rest,
  };
}

function github(
  now: number,
  state: WorldSourceStatus["state"],
  detail: string,
  itemCount: number,
): WorldSourceStatus {
  return {
    id: "github",
    label: "GitHub",
    enabled: true,
    state,
    detail,
    checkedAt: now,
    lastSuccessAt: state === "connected" ? now : null,
    itemCount,
    config: { kind: "github", mergedDays: 7 },
  };
}

/** The synthetic snapshot for `mode` at `now`. */
export function townWarehouseFixtureSnapshot(
  fixture: TownWarehouseFixtureMode,
  now: number,
): WorldSourcesSnapshot {
  if (fixture === "off")
    return {
      observedAt: now,
      refreshing: false,
      sources: [
        github(
          now,
          "not_connected",
          "Sign in with gh auth login as the user that runs World, then refresh.",
          0,
        ),
      ],
      items: [],
      links: [],
      actions: [],
    };
  const items: WorkItem[] = [
    pr(101, now, { title: "Synthetic: tidy the settings form" }),
    pr(102, now, {
      title: "Synthetic: faster board refresh",
      repo: "example-org/service",
    }),
    pr(103, now, {
      title: "Synthetic: retry flaky upload",
      checks: "fail",
      lane: "fixing",
    }),
    pr(104, now, {
      title: "Synthetic: new empty state",
      checks: "pending",
      lane: "review",
    }),
    pr(105, now, {
      title: "Synthetic: review someone's docs change",
      roles: ["reviewer"],
      review: "review_required",
      lane: "green",
      repo: "example-org/docs",
    }),
    pr(106, now, {
      title: "Synthetic: cache the avatars",
      lane: "green",
      pr: {
        baseRef: "main",
        behindBy: 0,
        checks: [{ name: "Unit tests", state: "pass", required: true }],
        checksTruncated: false,
        reviewers: [
          {
            reviewer: "rev-example",
            url: `https://example.com/${REPO}/pull/106#review`,
            at: now - 60_000,
            outcome: "open",
            line: "RESULT: 1 finding open",
            commit: (106 % 16).toString(16).repeat(40),
            commitsSince: 0,
          },
        ],
        uiChange: false,
        images: 0,
      },
    }),
    pr(107, now, {
      title: "Synthetic: sketch of the new menu",
      draft: true,
      lane: "review",
    }),
    pr(108, now, {
      title: "Synthetic: rename the export button",
      fresh: false,
    }),
  ];
  if (fixture === "many")
    for (let n = 120; n < 150; n += 1)
      items.push(
        pr(n, now, {
          title: `Synthetic: pile item ${n}`,
          checks: "pending",
          lane: "review",
        }),
      );
  return {
    observedAt: now,
    refreshing: false,
    sources: [github(now, "connected", "Up to date", items.length)],
    items,
    links: [],
    actions: [],
  };
}

/** The fixture with its first ready pull request merged. */
export function townWarehouseFixtureMerged(
  snapshot: WorldSourcesSnapshot,
): WorldSourcesSnapshot {
  const first = snapshot.items.find(
    (item) => item.lane === "ready" && !item.draft && item.checks === "pass",
  );
  if (!first) return snapshot;
  return {
    ...snapshot,
    items: snapshot.items.map((item) =>
      item === first
        ? { ...item, lane: "merged", finishedAt: clock.now() }
        : item,
    ),
  };
}

/** How long after loading the fixture merges its first ready pull request. */
export const TOWN_WAREHOUSE_FIXTURE_MERGE_MS = 10_000;

/**
 * The page's one synthetic snapshot at `now`: the warehouse and the Work
 * lens it opens (#887) agree on it, merged or not.
 */
function townWarehouseFixtureAt(
  fixture: TownWarehouseFixtureMode,
  now: number,
) {
  fixtureStart ??= now;
  const snapshot = townWarehouseFixtureSnapshot(fixture, fixtureStart);
  return fixture !== "off" &&
    now - fixtureStart >= TOWN_WAREHOUSE_FIXTURE_MERGE_MS
    ? townWarehouseFixtureMerged(snapshot)
    : snapshot;
}

/**
 * The snapshot the warehouse and its Work lens read: the GitHub source's,
 * or with the testing switch on, the synthetic one.
 */
export function useTownWarehouseSources(): WorldSourcesSnapshot {
  const live = useWorldSources();
  const [fixture] = useState(townWarehouseFixtureMode);
  const [synthetic, setSynthetic] = useState(() =>
    fixture ? townWarehouseFixtureAt(fixture, clock.now()) : null,
  );
  useEffect(() => {
    if (!fixture || fixture === "off" || fixtureStart === null) return;
    const left = fixtureStart + TOWN_WAREHOUSE_FIXTURE_MERGE_MS - clock.now();
    if (left <= 0) return;
    const timer = clock.setTimeout(
      () => setSynthetic(townWarehouseFixtureAt(fixture, clock.now())),
      left + 20,
    );
    return () => clock.clearTimeout(timer);
  }, [fixture]);
  return synthetic ?? live;
}
