import {
  PULL_REQUEST_LANES,
  TICKET_LANES,
  WORK_LANE_LABELS,
  type WorkItem,
  type WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import type { WorldObject } from "../worldObject";
import { linkMatchesPane, paneKey } from "../workLinks";

/**
 * Board's Work lens: pull requests and tickets as kanban columns, each card
 * naming the agents linked to it so the user can jump to their cards. Pure.
 */

export type WorkLensGroup = "pull_requests" | "tickets";

export type WorkLensAgent = {
  id: string;
  label: string;
  /** Idle or finished now: waiting for someone, not working. */
  idle: boolean;
};

export type WorkLensCard = { item: WorkItem; agents: WorkLensAgent[] };

/** One day of a history column (Merged, Done), newest first. */
export type WorkLensDay = { key: string; label: string; cards: WorkLensCard[] };

export type WorkLensColumn = {
  lane: WorkItem["lane"];
  label: string;
  cards: WorkLensCard[];
  /** History lanes only: the cards grouped by the day they finished. */
  days?: WorkLensDay[];
};

/** Lanes that only grow; a busy week fills them, so they group by day. */
const HISTORY_LANES = new Set<WorkItem["lane"]>(["merged", "done"]);

const finishedAt = (item: WorkItem) => item.finishedAt ?? item.updatedAt;

function localDay(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Group history cards by local day: Today, Yesterday, then dates. */
export function workLensDays(
  cards: WorkLensCard[],
  now: number,
): WorkLensDay[] {
  const today = localDay(now);
  const yesterday = localDay(
    new Date(new Date(now).setDate(new Date(now).getDate() - 1)).getTime(),
  );
  const days = new Map<string, WorkLensDay>();
  for (const card of cards) {
    const time = finishedAt(card.item);
    const key = localDay(time);
    let day = days.get(key);
    if (!day) {
      day = {
        key,
        label:
          key === today
            ? "Today"
            : key === yesterday
              ? "Yesterday"
              : new Date(time).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
        cards: [],
      };
      days.set(key, day);
    }
    day.cards.push(card);
  }
  return [...days.values()];
}

export function workLensColumns(
  snapshot: WorldSourcesSnapshot,
  world: WorldObject,
  group: WorkLensGroup,
  now = Date.now(),
): WorkLensColumn[] {
  const leaves = new Map(
    world.leaves.map((leaf) => [
      paneKey(leaf.connectionId, leaf.nativeId),
      leaf,
    ]),
  );
  const agentsByItem = new Map<string, WorkLensAgent[]>();
  for (const link of snapshot.links) {
    const leaf = leaves.get(paneKey(link.connectionId, link.paneId));
    // A restarted runtime or a new agent can reuse the pane ID.
    if (!leaf || !linkMatchesPane(link, leaf)) continue;
    const list = agentsByItem.get(link.itemKey) ?? [];
    if (!list.some((agent) => agent.id === leaf.id))
      list.push({
        id: leaf.id,
        label: leaf.agentName ?? leaf.agentLabel ?? leaf.tabLabel ?? leaf.label,
        idle: leaf.status === "idle" || leaf.status === "done",
      });
    agentsByItem.set(link.itemKey, list);
  }
  const lanes: readonly WorkItem["lane"][] =
    group === "pull_requests" ? PULL_REQUEST_LANES : TICKET_LANES;
  const wanted = (item: WorkItem) =>
    group === "pull_requests"
      ? item.kind === "pull_request"
      : item.kind !== "pull_request";
  return lanes.map((lane) => {
    const history = HISTORY_LANES.has(lane);
    const cards = snapshot.items
      .filter((item) => wanted(item) && item.lane === lane)
      .sort((a, b) =>
        history ? finishedAt(b) - finishedAt(a) : b.updatedAt - a.updatedAt,
      )
      .map((item) => ({ item, agents: agentsByItem.get(item.key) ?? [] }));
    return {
      lane,
      label: WORK_LANE_LABELS[lane],
      cards,
      ...(history ? { days: workLensDays(cards, now) } : {}),
    };
  });
}

/** Short state words for a pull request card, most important first. */
export function workCardFacts(item: WorkItem): string[] {
  if (item.kind !== "pull_request") return [item.status].filter(Boolean);
  const facts: string[] = [];
  if (item.draft) facts.push("draft");
  if (item.mergeable === "conflicting") facts.push("conflicts");
  if (item.review === "changes_requested") facts.push("changes requested");
  else if (item.review === "approved") facts.push("approved");
  if (item.checks === "fail") facts.push("checks failing");
  else if (item.checks === "pending") facts.push("checks running");
  else if (item.checks === "pass") facts.push("checks pass");
  return facts;
}
