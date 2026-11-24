import { useSyncExternalStore } from "react";

/**
 * Which room's plaque card is open: at most one in the town. A click or tap
 * on a plaque's title, or Enter or Space on the focused plaque, toggles its
 * card; another click on the title, a press outside the plaque or Escape
 * closes it. Hover and focus alone open nothing (TownRoomPlaque.tsx).
 */
let openKey: string | null = null;
const listeners = new Set<() => void>();

function set(key: string | null) {
  if (key === openKey) return;
  openKey = key;
  for (const listener of listeners) listener();
}

export const townPlaqueCard = {
  openKey: () => openKey,
  toggle(roomKey: string) {
    set(openKey === roomKey ? null : roomKey);
  },
  /** Close the open card, or only `roomKey`'s when given. */
  close(roomKey?: string) {
    if (roomKey === undefined || openKey === roomKey) set(null);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Whether `roomKey`'s plaque card is the open one. */
export function useTownPlaqueCardOpen(roomKey: string) {
  return useSyncExternalStore(
    townPlaqueCard.subscribe,
    () => openKey === roomKey,
    () => false,
  );
}
