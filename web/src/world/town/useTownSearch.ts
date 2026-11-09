/**
 * Town's search (#159): its results, the row Up and Down are on, and the
 * result chosen to show on the map. Choosing a result shows it; choosing it
 * again opens it as selecting does. A result Town does not draw opens at
 * once. Clearing the search ends it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { officePresentationKey } from "../officeSelection";
import type { WorldObject } from "../worldObject";
import { worldSearchResults, type WorldSearchResult } from "../worldSearch";

/**
 * A search result's Town key: rooms, tables, agents and buildings are keyed
 * by their result's ID; a terminal is drawn as its pane or its table.
 */
export function townSearchKey(
  office: HerdrOfficeProjection,
  result: WorldSearchResult,
) {
  return result.kind === "terminal"
    ? (officePresentationKey(office, result.id) ?? result.id)
    : result.id;
}

/** Where Escape ends Town's search: its results and the map. */
const TOWN_SEARCH_ESCAPE_SCOPE = ".world-search-results, .town-canvas-host";

/** "7 matches · 3 off-screen", or "No matches". */
export function townSearchLabel(matches: number, offscreen: number) {
  if (!matches) return "No matches";
  const count = matches === 1 ? "1 match" : `${matches} matches`;
  return offscreen ? `${count} · ${offscreen} off-screen` : count;
}

export function useTownSearch(
  world: WorldObject,
  office: HerdrOfficeProjection,
  onSelect: (id: string) => unknown,
) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => worldSearchResults(world, query),
    [query, world],
  );
  const [active, setActive] = useState<{ query: string; id: string } | null>(
    null,
  );
  const [chosenResult, setChosenResult] = useState<{
    query: string;
    id: string;
    nodeId: string;
    key: string;
    seq: number;
  } | null>(null);
  const chosenSeq = useRef(0);
  const [offscreen, setOffscreen] = useState(0);

  const open = query.trim() !== "";
  const activeId =
    active?.query === query && results.some(({ id }) => id === active.id)
      ? active.id
      : (results[0]?.id ?? null);
  const chosen = chosenResult?.query === query ? chosenResult : null;
  const keys = useMemo(
    () => results.map((result) => townSearchKey(office, result)),
    [results, office],
  );
  const chosenKey = chosen?.key ?? null;
  const chosenAt = chosen?.seq ?? null;
  const search = useMemo(
    () =>
      open
        ? {
            keys,
            chosen:
              chosenKey !== null && chosenAt !== null
                ? { key: chosenKey, seq: chosenAt }
                : null,
          }
        : null,
    [open, keys, chosenKey, chosenAt],
  );

  /** Show a result on the map, or open it when chosen again. True if opened. */
  const choose = (result: WorldSearchResult) => {
    setActive({ query, id: result.id });
    if (chosen?.id === result.id) {
      void onSelect(result.nodeId);
      return true;
    }
    chosenSeq.current += 1;
    setChosenResult({
      query,
      id: result.id,
      nodeId: result.nodeId,
      key: townSearchKey(office, result),
      seq: chosenSeq.current,
    });
    return false;
  };
  const activate = (id: string) => setActive({ query, id });
  /** End the search: Town as it was, no result shown or chosen. */
  const clear = () => {
    setQuery("");
    setActive(null);
    setChosenResult(null);
  };

  // Escape ends the search from its results or the map too, not only from
  // the search box (which handles its own). A key something else took, such
  // as putting back a carried desk, is left alone.
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        target !== document.body &&
        !target.closest(TOWN_SEARCH_ESCAPE_SCOPE)
      )
        return;
      event.preventDefault();
      clear();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);

  return {
    /** WorldViewToolbar's search props. */
    toolbar: {
      query,
      // A new query starts afresh: a result chosen for an earlier one is
      // not chosen again when that query comes back.
      onQueryChange: (next: string) => {
        setQuery(next);
        setActive(null);
        setChosenResult(null);
      },
      resultLabel: open
        ? townSearchLabel(results.length, offscreen)
        : undefined,
      onSubmit: () => {
        const result = results.find(({ id }) => id === activeId);
        return result ? choose(result) : false;
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
      offscreen,
    },
    /** TownCanvas's search prop. */
    canvas: {
      search,
      onOffscreen: setOffscreen,
      onUnmapped: (key: string) => {
        // Nothing to show on the map: open it as selecting does.
        if (chosen?.key === key) void onSelect(chosen.nodeId);
      },
    },
  };
}
