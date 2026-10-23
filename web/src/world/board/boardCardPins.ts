import { useSyncExternalStore } from "react";

/**
 * Board's pinned cards, published by the mounted Board for the terminal
 * window. On a phone a card's terminal covers Board, so its pin toggle sits in
 * that window's header instead of the card bar.
 */
export type BoardCardPins = {
  pinned: ReadonlySet<string>;
  /** Pin or unpin a card by its key; null while no Board is mounted. */
  toggle: ((key: string) => void) | null;
};

const NONE: BoardCardPins = { pinned: new Set(), toggle: null };
let current = NONE;
const listeners = new Set<() => void>();

export function publishBoardCardPins(next: BoardCardPins | null) {
  current = next ?? NONE;
  for (const listener of listeners) listener();
}

/** What Board has published now. */
export const currentBoardCardPins = () => current;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useBoardCardPins(): BoardCardPins {
  return useSyncExternalStore(subscribe, currentBoardCardPins);
}
