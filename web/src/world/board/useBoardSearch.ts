/**
 * Board's search (#159): the cards it lights up, its results, and the row Up
 * and Down are on. Enter or a click selects a result; the count is the
 * results list's, so the toolbar and the list agree. Escape, from the box or
 * the results, and the phone's close button end the search.
 */

import { useEffect, useMemo, useState } from "react";
import type { WorldObject } from "../worldObject";
import { worldSearchResults, type WorldSearchResult } from "../worldSearch";
import type { BoardModel } from "./boardModel";
import { boardSearchMatches } from "./boardSearch";

export function useBoardSearch(
  world: WorldObject,
  model: BoardModel,
  onSelect: (id: string) => unknown,
) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => worldSearchResults(world, query),
    [query, world],
  );
  const matches = useMemo(
    () => boardSearchMatches(model, query),
    [model, query],
  );
  const [active, setActive] = useState<{ query: string; id: string } | null>(
    null,
  );
  const open = query.trim() !== "";
  const activeId =
    active?.query === query && results.some(({ id }) => id === active.id)
      ? active.id
      : (results[0]?.id ?? null);

  const activate = (id: string) => setActive({ query, id });
  const choose = (result: WorldSearchResult) => {
    activate(result.id);
    void onSelect(result.nodeId);
  };
  const clear = () => {
    setQuery("");
    setActive(null);
  };

  // Escape from a result row ends the search too; the box handles its own.
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".world-search-results")) return;
      event.preventDefault();
      setQuery("");
      setActive(null);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);

  return {
    open,
    /** Card and workspace keys that match, or null with no query. */
    matches,
    /** WorldViewToolbar's search props. */
    toolbar: {
      query,
      onQueryChange: (next: string) => {
        setQuery(next);
        setActive(null);
      },
      resultLabel: open
        ? results.length === 0
          ? "No matches"
          : results.length === 1
            ? "1 match"
            : `${results.length} matches`
        : undefined,
      onSubmit: () => {
        const result = results.find(({ id }) => id === activeId);
        if (!result) return false;
        choose(result);
        return true;
      },
      onNavigate: (step: 1 | -1) => {
        if (!results.length) return;
        const at = results.findIndex(({ id }) => id === activeId);
        const next = Math.min(results.length - 1, Math.max(0, at + step));
        activate(results[next]!.id);
      },
      onClear: clear,
    },
    /** WorldSearchResults' props, besides the world and onSelect. */
    results: {
      query,
      results,
      activeId,
      onActivate: activate,
      onChoose: choose,
    },
  };
}
