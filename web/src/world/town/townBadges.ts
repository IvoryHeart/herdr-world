import {
  workBadgeText,
  type WorkItem,
  type WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { paneKey, workItemsByPane } from "../workLinks";

/**
 * A small badge on the desk of an agent working on a pull request or ticket:
 * `#123 ✓`, `#123 ✗`, `#123 ●` or `ABC-1`. A desk shows one, its open pull
 * request before a ticket. Pure.
 */

export type TownBadgeTone = "pass" | "fail" | "pending" | "plain";

export type TownDeskBadge = {
  text: string;
  tone: TownBadgeTone;
  url: string;
  /** The item it shows, so a pull request badge can open its card. */
  itemKey: string;
};

export function townDeskBadges(
  projection: HerdrOfficeProjection,
  snapshot: WorldSourcesSnapshot,
): ReadonlyMap<string, TownDeskBadge> {
  return deskBadges(townDeskWork(projection, snapshot));
}

/** The badge for each desk's work item (deskWork), keyed as the items are. */
export function deskBadges(
  work: ReadonlyMap<string, WorkItem>,
): ReadonlyMap<string, TownDeskBadge> {
  const badges = new Map<string, TownDeskBadge>();
  for (const [deskKey, item] of work)
    badges.set(deskKey, {
      text: workBadgeText(item),
      tone: toneOf(item),
      url: item.url,
      itemKey: item.key,
    });
  return badges;
}

/** A desk (a Herdr tab) and its panes, for its linked work. */
export type WorkDesk = {
  key: string;
  panes: readonly {
    connectionId: string;
    paneId: string;
    generation: number;
    agentSessionFingerprint?: string;
    agent: boolean;
  }[];
};

/**
 * The work item each desk's badge shows: its agents' open pull request
 * before a merged one, then a ticket. Town's Pull requests lens reads the
 * same items (townLens.ts).
 */
export function townDeskWork(
  projection: HerdrOfficeProjection,
  snapshot: WorldSourcesSnapshot,
): ReadonlyMap<string, WorkItem> {
  if (!snapshot.links.length) return new Map();
  return deskWork(
    projection.rooms.flatMap((room) =>
      room.desks.map((desk) => ({
        key: desk.key,
        panes: desk.paneDevices.map((device) => ({
          connectionId: device.paneRef.connectionId,
          paneId: device.paneRef.nativeId,
          generation: device.paneRef.generation,
          agentSessionFingerprint: device.agentSessionFingerprint,
          agent: !!device.agentKey,
        })),
      })),
    ),
    snapshot,
  );
}

/** Each desk's work item, keyed by desk; Town's and Board's desks alike. */
export function deskWork(
  desks: readonly WorkDesk[],
  snapshot: WorldSourcesSnapshot,
): ReadonlyMap<string, WorkItem> {
  const work = new Map<string, WorkItem>();
  if (!snapshot.links.length) return work;
  const panes = new Map(
    desks.flatMap((desk) =>
      desk.panes.map((pane) => [
        paneKey(pane.connectionId, pane.paneId),
        {
          generation: pane.generation,
          agentSessionFingerprint: pane.agentSessionFingerprint,
        },
      ]),
    ),
  );
  const byPane = workItemsByPane(snapshot, (connectionId, paneId) =>
    panes.get(paneKey(connectionId, paneId)),
  );
  for (const desk of desks) {
    const items = desk.panes.flatMap((pane) =>
      pane.agent
        ? (byPane.get(paneKey(pane.connectionId, pane.paneId)) ?? [])
        : [],
    );
    const item = [...items].sort((a, b) => rank(a) - rank(b))[0];
    if (item) work.set(desk.key, item);
  }
  return work;
}

function rank(item: WorkItem) {
  if (item.kind === "pull_request") return item.lane === "merged" ? 1 : 0;
  return 2;
}

function toneOf(item: WorkItem): TownBadgeTone {
  if (item.kind !== "pull_request") return "plain";
  if (item.lane === "fixing") return "fail";
  if (item.lane === "ready" || item.lane === "green" || item.lane === "merged")
    return "pass";
  return item.checks === "pending" ? "pending" : "plain";
}

/** Badges compare by content, so an unchanged poll does not repaint. */
export function sameTownBadges(
  left: ReadonlyMap<string, TownDeskBadge>,
  right: ReadonlyMap<string, TownDeskBadge>,
) {
  if (left.size !== right.size) return false;
  for (const [key, badge] of left) {
    const other = right.get(key);
    if (
      !other ||
      other.text !== badge.text ||
      other.tone !== badge.tone ||
      other.url !== badge.url ||
      other.itemKey !== badge.itemKey
    )
      return false;
  }
  return true;
}
