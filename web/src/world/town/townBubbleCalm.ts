/**
 * Calm bubbles at scale (#903). With hundreds of agents, zoomed out, every
 * waiting agent's bubble would stack into a wall and a lobby crowd would curse
 * all at once. Two rules thin them, without hiding a kind of attention:
 *
 * - A lobby crowd takes turns grumbling: one cursing bubble per building at a
 *   time, the turn passing every `TOWN_GRUMBLE_TURN` seconds. The crowd's
 *   bodies still wave and stamp; only the bubble waits its turn.
 * - Zoomed out (the overview), a patch of screen the size of a far bubble
 *   holds one bubble: the most urgent there (blocked, then a question, out
 *   of fuel, finished, a quiet working agent or the crowd, then the rest).
 *   One bubble still says something is there; zooming in shows each.
 */

import type { townBubbleKind } from "./townBubbleKind";

export type TownBubbleKindName = NonNullable<ReturnType<typeof townBubbleKind>>;

/** A bubble the renderer would draw this frame, at its screen point. */
export type TownBubbleCandidate = {
  key: string;
  kind: TownBubbleKindName;
  /** The building whose lobby a cursing agent stands in. */
  hostKey: string;
  x: number;
  y: number;
};

/** Seconds each grumbler's turn lasts. */
export const TOWN_GRUMBLE_TURN = 1.6;
/** A far bubble's patch of screen, in CSS pixels: about its drawn size. */
export const TOWN_BUBBLE_PATCH = { w: 30, h: 26 } as const;

const RANK: Record<TownBubbleKindName, number> = {
  blocked: 0,
  ask: 1,
  fuel: 2,
  done: 3,
  quiet: 4,
  curse: 4,
  confused: 5,
  sleep: 6,
  idle: 7,
  typing0: 8,
  typing1: 8,
  typing2: 8,
};

/**
 * The keys of the bubbles to draw: one curse per building, the one whose
 * turn it is (`turn` counts turns, so a still town keeps one grumbler), and,
 * unless `near` (room or desk level), one bubble per patch of screen.
 */
export function townCalmBubbles(
  candidates: readonly TownBubbleCandidate[],
  near: boolean,
  turn: number,
): Set<string> {
  const cursing = new Map<string, string[]>();
  for (const bubble of candidates)
    if (bubble.kind === "curse") {
      const crowd = cursing.get(bubble.hostKey);
      if (crowd) crowd.push(bubble.key);
      else cursing.set(bubble.hostKey, [bubble.key]);
    }
  const speaking = new Set<string>();
  for (const crowd of cursing.values()) {
    // Key order is stable as agents join and leave the crowd.
    crowd.sort();
    speaking.add(crowd[turn % crowd.length]!);
  }
  const turns = candidates.filter(
    (bubble) => bubble.kind !== "curse" || speaking.has(bubble.key),
  );
  if (near) return new Set(turns.map((bubble) => bubble.key));
  const { w, h } = TOWN_BUBBLE_PATCH;
  const ranked = turns
    .map((bubble, index) => ({ bubble, index }))
    .sort(
      (a, b) => RANK[a.bubble.kind] - RANK[b.bubble.kind] || a.index - b.index,
    );
  // Kept bubbles by grid cell; a new one checks its cell and the eight
  // around it, so the check stays linear in the number of bubbles.
  const grid = new Map<string, TownBubbleCandidate[]>();
  const kept = new Set<string>();
  for (const { bubble } of ranked) {
    const cx = Math.floor(bubble.x / w);
    const cy = Math.floor(bubble.y / h);
    let crowded = false;
    for (let dx = -1; dx <= 1 && !crowded; dx++)
      for (let dy = -1; dy <= 1 && !crowded; dy++)
        crowded = (grid.get(`${cx + dx}:${cy + dy}`) ?? []).some(
          (other) =>
            Math.abs(other.x - bubble.x) < w &&
            Math.abs(other.y - bubble.y) < h,
        );
    if (crowded) continue;
    kept.add(bubble.key);
    const cell = `${cx}:${cy}`;
    const list = grid.get(cell);
    if (list) list.push(bubble);
    else grid.set(cell, [bubble]);
  }
  return kept;
}
