/**
 * World's one search (#159, #1355). There is one box: the command box
 * (CommandCombobox, with World's finds from worldCommandBox.tsx). Every way
 * in opens it: `/` and Ctrl+F (`view.search`), Cmd+K (`command.menu`), a
 * view's search button and the phone's Find or act (commandBoxKey.ts). Its
 * results come from pluggable sources: World's objects (worldSearch.ts, the
 * one matcher), what only the current view has (Town's landmarks), the box's
 * commands and the settings registry.
 *
 * Choosing a result goes to it in the current view. This is the search the
 * box shares with that view while it runs: what is typed, so Town and Board
 * light their matches as it is typed, and what was chosen, so Town flies to
 * it. Closing the box without choosing ends the search; once a result is
 * chosen the search stays until the view's Escape or clear ends it, so Town
 * keeps its matches lit and its camera where it went. It holds a query and a
 * search result, never World state: the views read World from World.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { WorldSearchResult } from "./worldSearch";
import type { WorldView } from "./worldViewRouting";

/** A chosen result; a new `seq` asks the view to go to it again. */
type WorldFinderChoice = { result: WorldSearchResult; seq: number };

/** The search the box shares with the view it was opened in. */
export type WorldFinderSearch = {
  view: WorldView;
  query: string;
  chosen: WorldFinderChoice | null;
};

let current: WorldFinderSearch | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: WorldFinderSearch | null) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** The one search's shared state; the box writes it, the views read it. */
export const worldFinder = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** The box's text as it is typed: a new query starts afresh. */
  type(view: WorldView, query: string) {
    if (!query.trim()) set(null);
    else if (current?.view !== view || current.query !== query)
      set({ view, query, chosen: null });
  },
  /** A result chosen in `view`, which goes to it. */
  choose(view: WorldView, query: string, result: WorldSearchResult) {
    seq += 1;
    set({ view, query, chosen: { result, seq } });
  },
  /** The box closed: a search with nothing chosen ends. */
  closed() {
    if (current && !current.chosen) set(null);
  },
  /** End the search, or only `view`'s. */
  end(view?: WorldView) {
    if (current && (!view || current.view === view)) set(null);
  },
};

/** The search running in `view`, or null. */
export function useWorldFinderSearch(view: WorldView) {
  const search = useSyncExternalStore(
    worldFinder.subscribe,
    worldFinder.get,
    worldFinder.get,
  );
  return search?.view === view ? search : null;
}

/** How the command box shares its search with the view it is opened in. */
export type FinderSearch = {
  seed(): string;
  change(search: string): void;
  closed(): void;
};

/**
 * Closing the box, however it closes, ends a search nothing was chosen from.
 * A choice runs before this.
 */
export function useFinderBoxClosed(open: boolean, finder?: FinderSearch) {
  const finderRef = useRef(finder);
  finderRef.current = finder;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (!open) finderRef.current?.closed();
  }, [open]);
}
