import {
  PULL_REQUEST_LANES,
  TICKET_LANES,
  WORK_LANE_LABELS,
  type WorkItem,
  type WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import type { WorldObject } from "../worldObject";
import { paneKey } from "../worldSources";

/**
 * Board's Work lens: pull requests and tickets as kanban columns, each card
 * naming the agents linked to it so the user can jump to their cards. Pure.
 */

export type WorkLensGroup = "pull_requests" | "tickets";

export type WorkLensAgent = { id: string; label: string };

export type WorkLensCard = { item: WorkItem; agents: WorkLensAgent[] };

export type WorkLensColumn = {
  lane: WorkItem["lane"];
  label: string;
  cards: WorkLensCard[];
};

export function workLensColumns(
  snapshot: WorldSourcesSnapshot,
  world: WorldObject,
  group: WorkLensGroup,
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
    if (!leaf) continue;
    const list = agentsByItem.get(link.itemKey) ?? [];
    if (!list.some((agent) => agent.id === leaf.id))
      list.push({
        id: leaf.id,
        label: leaf.agentName ?? leaf.agentLabel ?? leaf.tabLabel ?? leaf.label,
      });
    agentsByItem.set(link.itemKey, list);
  }
  const lanes: readonly WorkItem["lane"][] =
    group === "pull_requests" ? PULL_REQUEST_LANES : TICKET_LANES;
  const wanted = (item: WorkItem) =>
    group === "pull_requests"
      ? item.kind === "pull_request"
      : item.kind !== "pull_request";
  return lanes.map((lane) => ({
    lane,
    label: WORK_LANE_LABELS[lane],
    cards: snapshot.items
      .filter((item) => wanted(item) && item.lane === lane)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => ({ item, agents: agentsByItem.get(item.key) ?? [] })),
  }));
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
