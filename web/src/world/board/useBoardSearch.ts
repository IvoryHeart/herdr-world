/**
 * Board's part of World's one search (#159, #1355): the cards the search box
 * (worldFinder.ts) lights as it is typed, and the count, so the toolbar and
 * the box agree. Choosing a result in the box selects it on Board. Escape,
 * from the board, or the toolbar's × ends the search.
 */

import { useEffect, useMemo } from "react";
import { worldFinder, useWorldFinderSearch } from "../worldFinder";
import type { WorldObject } from "../worldObject";
import { worldSearchResults } from "../worldSearch";
import type { BoardModel } from "./boardModel";
import { boardSearchMatches } from "./boardSearch";

/** Where Escape ends Board's search: the board, or nothing focused. */
const BOARD_SEARCH_ESCAPE_SCOPE = ".board";

export function useBoardSearch(world: WorldObject, model: BoardModel) {
  const query = useWorldFinderSearch("board")?.query ?? "";
  const count = useMemo(
    () => (query.trim() ? worldSearchResults(world, query).length : 0),
    [query, world],
  );
  const matches = useMemo(
    () => boardSearchMatches(model, query),
    [model, query],
  );
  const open = query.trim() !== "";

  // Escape ends the search from the board too, not only from the toolbar. A
  // key something else took, such as putting back a carried pane, is left
  // alone.
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        target !== document.body &&
        !target.closest(BOARD_SEARCH_ESCAPE_SCOPE)
      )
        return;
      event.preventDefault();
      worldFinder.end("board");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);

  return {
    /** Card and workspace keys that match, or null with no query. */
    matches,
    /** WorldViewToolbar's props. */
    toolbar: {
      query,
      resultLabel: open
        ? count === 0
          ? "No matches"
          : count === 1
            ? "1 match"
            : `${count} matches`
        : undefined,
      onClear: () => worldFinder.end("board"),
    },
  };
}
