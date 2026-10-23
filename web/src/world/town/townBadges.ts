import {
  workBadgeText,
  type WorkItem,
  type WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { paneKey, workItemsByPane } from "../worldSources";

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
  const badges = new Map<string, TownDeskBadge>();
  if (!snapshot.links.length) return badges;
  const panes = new Map(
    projection.rooms.flatMap((room) =>
      room.desks.flatMap((desk) =>
        desk.paneDevices.map((device) => [
          paneKey(device.paneRef.connectionId, device.paneRef.nativeId),
          {
            generation: device.paneRef.generation,
            agentSessionFingerprint: device.agentSessionFingerprint,
          },
        ]),
      ),
    ),
  );
  const byPane = workItemsByPane(snapshot, (connectionId, paneId) =>
    panes.get(paneKey(connectionId, paneId)),
  );
  for (const room of projection.rooms)
    for (const desk of room.desks) {
      const items = desk.paneDevices.flatMap((device) =>
        device.agentKey
          ? (byPane.get(
              paneKey(device.paneRef.connectionId, device.paneRef.nativeId),
            ) ?? [])
          : [],
      );
      const item = [...items].sort((a, b) => rank(a) - rank(b))[0];
      if (item)
        badges.set(desk.key, {
          text: workBadgeText(item),
          tone: toneOf(item),
          url: item.url,
          itemKey: item.key,
        });
    }
  return badges;
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
