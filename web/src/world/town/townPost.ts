import { freshPullRequestDetail } from "../../../../shared/pullRequestFreshness";
import {
  actionablePullRequest,
  pullRequestReadiness,
  readyToMerge,
  type ReadinessRuleId,
} from "../../../../shared/pullRequests";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import { TOWN_CENTER_FRIEZE_Y, type TownCenterLot } from "./townCenter";
import { TOWN_TILE, type TownLayout } from "./townLayout";
import { townPostLotBeside, type TownPostLot } from "./townPostLot";

/**
 * Town's post office (#760): a projection of the GitHub source's open pull
 * requests, yours and those waiting on your review, as parcels in a sorting
 * yard by the park. It reads only the snapshot every other view reads
 * (useWorldSources) and the merge rules the pull request card applies
 * (shared/pullRequests.ts), and it keeps their honesty rules:
 *
 * - Ready means every merge rule holds on fresh detail (readyToMerge); stale
 *   or partial detail is never ready, it is unknown.
 * - A source that is off, signed out or never answered shows no parcels and
 *   no counts, only how to connect it.
 * - A source whose last refresh failed keeps its last list, and every parcel
 *   in it is unknown: out of date, not ready, failing or waiting.
 *
 * Pure: the layout geometry and the read model, for the painter, the
 * landscape, the DOM layer and tests.
 */

/** How a parcel looks: its state, worst-to-act-on last. */
export type TownPostState =
  | "ready"
  | "failing"
  | "waiting"
  | "unknown"
  | "draft";

/** The yard's order: ready to merge first, drafts last. */
export const TOWN_POST_STATES: readonly TownPostState[] = [
  "ready",
  "failing",
  "waiting",
  "unknown",
  "draft",
];

export type TownPostParcel = {
  /** The work item's key. */
  key: string;
  number: number | null;
  title: string;
  repo: string;
  state: TownPostState;
  /** The state in words: "ready to merge", "waiting for CI". */
  why: string;
};

export type TownPostCounts = Record<TownPostState, number>;

export type TownPostOffice =
  /** No source has answered yet: nothing to say. */
  | { status: "loading" }
  /** The GitHub source is switched off in Sources. */
  | { status: "off" }
  /** Signed out, not installed or never reached; `detail` says what to do. */
  | { status: "closed"; detail: string }
  | {
      status: "open";
      parcels: TownPostParcel[];
      counts: TownPostCounts;
      /** The last refresh failed: the list is the last good one. */
      stale: boolean;
    };

/** Roles that bring a pull request to your post office. */
const ROLES = new Set(["author", "reviewer", "assignee"]);

/** An open pull request World's GitHub source brought for you. */
export function townPostItem(item: WorkItem) {
  return (
    item.source === "github" &&
    item.kind === "pull_request" &&
    item.lane !== "merged" &&
    item.roles.some((role) => ROLES.has(role))
  );
}

/** A rule that keeps a fresh, authored pull request from ready, in words. */
const RULE_FAILS: Record<ReadinessRuleId, string> = {
  draft: "draft",
  findings: "review findings open",
  checks: "CI failing on its head",
  mergeable: "conflicts with its base",
  screenshots: "UI change without screenshots",
};

/** Where a pull request stands, with the merge rules' honesty. */
export function townPostState(
  item: WorkItem,
  now: number,
): { state: TownPostState; why: string } {
  if (item.draft) return { state: "draft", why: "draft" };
  if (item.checks === "fail")
    return { state: "failing", why: "CI failing on its head" };
  if (readyToMerge(item, now)) return { state: "ready", why: "ready to merge" };
  if (!item.roles.includes("author"))
    return {
      state: "waiting",
      why: item.roles.includes("reviewer")
        ? "your review requested"
        : "assigned to you",
    };
  // What GitHub's list says holds whatever the detail's age.
  if (item.checks === "pending")
    return { state: "waiting", why: "waiting for CI" };
  if (item.review === "changes_requested")
    return { state: "waiting", why: "changes requested" };
  if (item.mergeable === "conflicting")
    return { state: "waiting", why: "conflicts with its base" };
  if (!actionablePullRequest(item) || !freshPullRequestDetail(item, now))
    return { state: "unknown", why: "details out of date" };
  const rules = pullRequestReadiness(item, now);
  const failed = rules.find((rule) => rule.state === "fail");
  if (failed) return { state: "waiting", why: RULE_FAILS[failed.id] };
  const open = rules.find((rule) => rule.state === "unknown");
  if (open?.id === "findings")
    return { state: "waiting", why: "waiting for review" };
  if (open?.id === "checks") return { state: "waiting", why: "waiting for CI" };
  if (open?.id === "mergeable")
    return { state: "waiting", why: "GitHub still checking for conflicts" };
  return { state: "unknown", why: "changed files not read" };
}

const emptyCounts = (): TownPostCounts => ({
  ready: 0,
  failing: 0,
  waiting: 0,
  unknown: 0,
  draft: 0,
});

/** The post office as the GitHub source has it now. */
export function townPostOffice(
  snapshot: WorldSourcesSnapshot,
  now: number,
): TownPostOffice {
  const github = snapshot.sources.find((source) => source.id === "github");
  if (!github)
    return snapshot.sources.length
      ? { status: "closed", detail: "World has no GitHub source." }
      : { status: "loading" };
  if (!github.enabled || github.state === "disabled") return { status: "off" };
  if (
    github.state === "not_connected" ||
    (github.state === "error" && github.lastSuccessAt === null)
  )
    return { status: "closed", detail: github.detail };
  const stale = github.state === "error";
  const updated = new Map<string, number>();
  const parcels: TownPostParcel[] = snapshot.items
    .filter(townPostItem)
    .map((item) => {
      updated.set(item.key, item.updatedAt);
      return {
        key: item.key,
        number: item.number ?? null,
        title: item.title,
        repo: item.repo ?? item.ref,
        ...(stale
          ? { state: "unknown" as const, why: "GitHub out of date" }
          : townPostState(item, now)),
      };
    });
  parcels.sort(
    (a, b) =>
      TOWN_POST_STATES.indexOf(a.state) - TOWN_POST_STATES.indexOf(b.state) ||
      updated.get(b.key)! - updated.get(a.key)! ||
      a.key.localeCompare(b.key),
  );
  const counts = emptyCounts();
  for (const parcel of parcels) counts[parcel.state] += 1;
  return {
    status: "open",
    parcels,
    counts,
    stale,
  };
}

const COUNT_WORDS: Record<TownPostState, string> = {
  ready: "ready",
  failing: "failing",
  waiting: "waiting",
  unknown: "unknown",
  draft: "draft",
};

/**
 * The sign's counts: ready, failing and waiting always (a zero there is
 * GitHub's answer), unknown and drafts when there are some.
 */
export function townPostCountParts(counts: TownPostCounts) {
  return TOWN_POST_STATES.filter(
    (state) =>
      state === "ready" ||
      state === "failing" ||
      state === "waiting" ||
      counts[state] > 0,
  ).map((state) => ({
    state,
    count: counts[state],
    text: `${counts[state]} ${COUNT_WORDS[state]}`,
  }));
}

/** "3 ready · 1 failing · 4 waiting", or what stands in for counts. */
export function townPostSignText(office: TownPostOffice) {
  switch (office.status) {
    case "loading":
      return "Opening…";
    case "off":
      return "Closed · GitHub source is off";
    case "closed":
      return "Closed · connect GitHub in Sources";
    case "open":
      return office.stale
        ? `GitHub out of date · ${office.parcels.length} unknown`
        : townPostCountParts(office.counts)
            .map((part) => part.text)
            .join(" · ");
  }
}

/** "#123 Fix the login form": a parcel's name. */
export const townPostName = (parcel: TownPostParcel) =>
  `${parcel.number === null ? "" : `#${parcel.number} `}${parcel.title}`;

/** A parcel in words: its name, repository and state. */
export const townPostLabel = (parcel: TownPostParcel) =>
  `${townPostName(parcel)}, ${parcel.repo}, ${parcel.why}`;

/* ---------- where it stands ---------- */

export {
  TOWN_POST_HOUSE_ROWS,
  TOWN_POST_WIDTH,
  TOWN_POST_YARD_ROWS,
  townPostReserve,
  type TownPostLot,
} from "./townPostLot";

/** Columns of parcels in the yard; its right end keeps the mail cart. */
export const TOWN_POST_COLUMNS = 7;
export const TOWN_POST_ROWS = 3;
/** Parcels the yard holds; more show as a "+N" pile. */
export const TOWN_POST_SLOTS = TOWN_POST_COLUMNS * TOWN_POST_ROWS;

/** A parcel's slot in the yard, in pixels from the yard's top-left. */
export const TOWN_POST_PITCH = { x: 20, y: 18 } as const;
export const TOWN_POST_INSET = { x: 6, y: 6 } as const;

/**
 * The post office's lot: right beside the town center, outside the building
 * grid (townPostLot.ts). A narrow (stacked) town folds it to a sign on the
 * town center instead, as it does the city billboard. Nothing in the layout
 * moves for it; the landscape keeps its lot clear.
 */
export function townPostLot(layout: TownLayout): TownPostLot | null {
  if (layout.formFactor === "narrow") return null;
  return townPostLotBeside(layout.center);
}

/**
 * Where a narrow town's folded post office sign hangs, in world pixels: on
 * the town center's right wing, under its windows and level with the doors.
 * A phone's home view keeps the center from just above its plaque down, so
 * the sign stays in view there; the roofs and tower above it are cropped.
 */
export function townPostFoldAt(center: TownCenterLot) {
  return {
    x: (center.x + center.w) * TOWN_TILE - 60,
    y: center.y * TOWN_TILE + TOWN_CENTER_FRIEZE_Y + 40,
  };
}

/** Slot `index`'s top-left in the yard, in pixels. */
export function townPostSlot(index: number) {
  return {
    x: TOWN_POST_INSET.x + (index % TOWN_POST_COLUMNS) * TOWN_POST_PITCH.x,
    y:
      TOWN_POST_INSET.y +
      Math.floor(index / TOWN_POST_COLUMNS) * TOWN_POST_PITCH.y,
  };
}
