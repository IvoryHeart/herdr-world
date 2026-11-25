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
import type { TownLayout } from "./townLayout";
import { townHarbourLot } from "./townHarbour";
import type { TownWarehouseLot } from "./townHarbourLot";

/**
 * Town's warehouse (#1028; the post office's pull requests until then,
 * #760): a projection of the GitHub source's open pull requests, yours and
 * those waiting on your review, as crates in its yard on the harbour shore,
 * waiting to be loaded for a release. It reads only the snapshot every other view reads
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
export type TownWarehouseState =
  | "ready"
  | "failing"
  | "waiting"
  | "unknown"
  | "draft";

/** The yard's order: ready to merge first, drafts last. */
export const TOWN_WAREHOUSE_STATES: readonly TownWarehouseState[] = [
  "ready",
  "failing",
  "waiting",
  "unknown",
  "draft",
];

export type TownWarehouseParcel = {
  /** The work item's key. */
  key: string;
  number: number | null;
  title: string;
  repo: string;
  state: TownWarehouseState;
  /** The state in words: "ready to merge", "waiting for CI". */
  why: string;
};

export type TownWarehouseCounts = Record<TownWarehouseState, number>;

export type TownWarehouse =
  /** No source has answered yet: nothing to say. */
  | { status: "loading" }
  /** The GitHub source is switched off in Integrations. */
  | { status: "off" }
  /** Signed out, not installed or never reached; `detail` says what to do. */
  | { status: "closed"; detail: string }
  | {
      status: "open";
      parcels: TownWarehouseParcel[];
      counts: TownWarehouseCounts;
      /** The last refresh failed: the list is the last good one. */
      stale: boolean;
    };

/** Roles that bring a pull request to your warehouse. */
const ROLES = new Set(["author", "reviewer", "assignee"]);

/** An open pull request World's GitHub source brought for you. */
export function townWarehouseItem(item: WorkItem) {
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
export function townWarehouseState(
  item: WorkItem,
  now: number,
): { state: TownWarehouseState; why: string } {
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

const emptyCounts = (): TownWarehouseCounts => ({
  ready: 0,
  failing: 0,
  waiting: 0,
  unknown: 0,
  draft: 0,
});

/** The warehouse as the GitHub source has it now. */
export function townWarehouse(
  snapshot: WorldSourcesSnapshot,
  now: number,
): TownWarehouse {
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
  const parcels: TownWarehouseParcel[] = snapshot.items
    .filter(townWarehouseItem)
    .map((item) => {
      updated.set(item.key, item.updatedAt);
      return {
        key: item.key,
        number: item.number ?? null,
        title: item.title,
        repo: item.repo ?? item.ref,
        ...(stale
          ? { state: "unknown" as const, why: "GitHub out of date" }
          : townWarehouseState(item, now)),
      };
    });
  parcels.sort(
    (a, b) =>
      TOWN_WAREHOUSE_STATES.indexOf(a.state) -
        TOWN_WAREHOUSE_STATES.indexOf(b.state) ||
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

const COUNT_WORDS: Record<TownWarehouseState, string> = {
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
export function townWarehouseCountParts(counts: TownWarehouseCounts) {
  return TOWN_WAREHOUSE_STATES.filter(
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
export function townWarehouseSignText(office: TownWarehouse) {
  switch (office.status) {
    case "loading":
      return "Opening…";
    case "off":
      return "Closed · GitHub source is off";
    case "closed":
      return "Closed · connect GitHub in Integrations";
    case "open":
      return office.stale
        ? `GitHub out of date · ${office.parcels.length} unknown`
        : townWarehouseCountParts(office.counts)
            .map((part) => part.text)
            .join(" · ");
  }
}

/** "#123 Fix the login form": a parcel's name. */
export const townWarehouseName = (parcel: TownWarehouseParcel) =>
  `${parcel.number === null ? "" : `#${parcel.number} `}${parcel.title}`;

/** A parcel in words: its name, repository and state. */
export const townWarehouseLabel = (parcel: TownWarehouseParcel) =>
  `${townWarehouseName(parcel)}, ${parcel.repo}, ${parcel.why}`;

/* ---------- where it stands ---------- */

export {
  TOWN_WAREHOUSE_HOUSE_ROWS,
  TOWN_WAREHOUSE_WIDTH,
  TOWN_WAREHOUSE_YARD_ROWS,
  townWarehouseReserve,
  type TownWarehouseLot,
} from "./townHarbourLot";

/** Columns of crates in the yard; its right end keeps the hand cart. */
export const TOWN_WAREHOUSE_COLUMNS = 7;
export const TOWN_WAREHOUSE_ROWS = 3;
/** Parcels the yard holds; more show as a "+N" pile. */
export const TOWN_WAREHOUSE_SLOTS =
  TOWN_WAREHOUSE_COLUMNS * TOWN_WAREHOUSE_ROWS;

/** A parcel's slot in the yard, in pixels from the yard's top-left. */
export const TOWN_WAREHOUSE_PITCH = { x: 20, y: 18 } as const;
export const TOWN_WAREHOUSE_INSET = { x: 6, y: 6 } as const;

/**
 * The warehouse's lot: on the harbour shore at the first street's end,
 * outside the building grid (townHarbourLot.ts), on every form factor. The
 * landscape keeps its lot clear.
 */
export function townWarehouseLot(layout: TownLayout): TownWarehouseLot {
  return townHarbourLot(layout).warehouse;
}

/** Slot `index`'s top-left in the yard, in pixels. */
export function townWarehouseSlot(index: number) {
  return {
    x:
      TOWN_WAREHOUSE_INSET.x +
      (index % TOWN_WAREHOUSE_COLUMNS) * TOWN_WAREHOUSE_PITCH.x,
    y:
      TOWN_WAREHOUSE_INSET.y +
      Math.floor(index / TOWN_WAREHOUSE_COLUMNS) * TOWN_WAREHOUSE_PITCH.y,
  };
}
