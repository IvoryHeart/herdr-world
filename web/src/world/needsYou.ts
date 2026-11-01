import { worldLocalStorage } from "../browserStorage";
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

/**
 * The Needs you tab's shared state: open or closed (remembered per device),
 * the newest opener request, and Town's Outbox opener while Town shows.
 * Every opener request gets a new sequence number, so asking again for the
 * same item still turns the list to that item's page.
 */
export type NeedsYouState = {
  open: boolean;
  request: { itemKey?: string; sequence: number };
  openOutbox: (() => void) | null;
};

const OPEN_KEY = "needsYou.open.v1";
const listeners = new Set<() => void>();
let state: NeedsYouState | null = null;

const readOpen = () => {
  try {
    return worldLocalStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
};

export const needsYouState = () =>
  (state ??= {
    open: readOpen(),
    request: { sequence: 0 },
    openOutbox: null,
  });

export const subscribeNeedsYou = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function update(patch: Partial<NeedsYouState>) {
  const previous = needsYouState();
  state = { ...previous, ...patch };
  if (state.open !== previous.open)
    try {
      worldLocalStorage.setItem(OPEN_KEY, state.open ? "1" : "0");
    } catch {
      // Private windows: the tab still opens; it is not remembered.
    }
  listeners.forEach((listener) => listener());
}

/** Openers (the counter, reception, Desk, Board) show the tab at an item. */
export function openNeedsYou(itemKey?: string) {
  update({
    open: true,
    request: { itemKey, sequence: needsYouState().request.sequence + 1 },
  });
}

export const closeNeedsYou = () => update({ open: false });

export function toggleNeedsYou() {
  if (needsYouState().open) closeNeedsYou();
  else openNeedsYou();
}

/** Town offers its Outbox (saved answers to check) while it shows. */
export function offerNeedsYouOutbox(open: () => void) {
  update({ openOutbox: open });
  return () => {
    if (needsYouState().openOutbox === open) update({ openOutbox: null });
  };
}

/** Tests start from a closed tab. */
export function resetNeedsYouForTest() {
  state = null;
  listeners.clear();
}
