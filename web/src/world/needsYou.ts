import { askLeaves } from "./worldAskTargets";
import type { WorldAsk } from "./worldAsks";
import type { WorldLeafObject, WorldObject } from "./worldObject";

/**
 * What waits on the owner, as one conversation: questions agents asked
 * (`herdr-world ask`, oldest first), agents blocked on their own question
 * (oldest first), then finished work not reviewed yet (newest first):
 * done agents and idle ones whose turn ended recently, as Desk's review lane.
 */
export type NeedsYouItem =
  | { kind: "asks"; key: string; ask: WorldAsk; leaf: WorldLeafObject | null }
  | { kind: "needs"; key: string; leaf: WorldLeafObject }
  | { kind: "done"; key: string; leaf: WorldLeafObject };

/** The item key for an agent, so openers can show the window at it. */
export const needsYouLeafKey = (leafId: string) => `leaf:${leafId}`;
export const needsYouAskKey = (askId: string) => `ask:${askId}`;

export function needsYouItems(
  world: Pick<WorldObject, "leaves" | "nodeById">,
  asks: readonly WorldAsk[],
  toReview: (leaf: WorldLeafObject) => boolean,
): NeedsYouItem[] {
  const askedBy = askLeaves(asks, world);
  const leafOf = (id: string | undefined) => {
    const node = id ? world.nodeById.get(id) : undefined;
    return node && node.kind !== "host" && node.kind !== "space" ? node : null;
  };
  const live = world.leaves.filter(
    (leaf) => leaf.kind === "agent" && leaf.actionable && !leaf.stale,
  );
  const at = (leaf: WorldLeafObject) => leaf.lastActivityAt ?? 0;
  return [
    ...[...asks]
      .sort((left, right) => left.at - right.at)
      .map(
        (ask): NeedsYouItem => ({
          kind: "asks",
          key: needsYouAskKey(ask.id),
          ask,
          leaf: leafOf(askedBy.get(ask.id)),
        }),
      ),
    ...live
      .filter((leaf) => leaf.status === "blocked")
      .sort((left, right) => at(left) - at(right))
      .map(
        (leaf): NeedsYouItem => ({
          kind: "needs",
          key: needsYouLeafKey(leaf.id),
          leaf,
        }),
      ),
    ...live
      .filter((leaf) => leaf.status !== "blocked" && toReview(leaf))
      .sort((left, right) => at(right) - at(left))
      .map(
        (leaf): NeedsYouItem => ({
          kind: "done",
          key: needsYouLeafKey(leaf.id),
          leaf,
        }),
      ),
  ];
}

/** The counter: questions and blocked agents; finished work waits below. */
export const needsYouCount = (items: readonly NeedsYouItem[]) =>
  items.filter((item) => item.kind !== "done").length;

/** Openers (the counter, reception, Desk, Board) ask for the window here. */
export const NEEDS_YOU_OPEN_EVENT = "herdr-world:needs-you-open";

export function openNeedsYou(itemKey?: string) {
  window.dispatchEvent(
    new CustomEvent<{ itemKey?: string }>(NEEDS_YOU_OPEN_EVENT, {
      detail: { itemKey },
    }),
  );
}
