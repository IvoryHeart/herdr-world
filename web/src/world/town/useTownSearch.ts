/**
 * Town's part of World's one search (#159, #1355): what the search box
 * (worldFinder.ts) lights on the map as it is typed, and the result chosen
 * there, which the camera flies to and pulses. A result Town does not draw
 * opens as selecting does. Escape or the toolbar's × ends the search.
 */

import { useEffect, useMemo, useState } from "react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { officePresentationKey } from "../officeSelection";
import type { WorldObject } from "../worldObject";
import { worldFinder, useWorldFinderSearch } from "../worldFinder";
import { worldSearchResults, type WorldSearchResult } from "../worldSearch";
import { townLandmarkKey, townLandmarkResults } from "./townSearch";

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

/**
 * Town's results: its landmarks (the warehouse) and World's nodes, names
 * before places before task summaries.
 */
export function townSearchResults(world: WorldObject, query: string) {
  // A stable sort keeps landmarks first within a rank.
  return [
    ...townLandmarkResults(query),
    ...worldSearchResults(world, query),
  ].sort((a, b) => a.rank - b.rank);
}

/** Where Escape ends Town's search: the map, or nothing focused. */
const TOWN_SEARCH_ESCAPE_SCOPE = ".town-canvas-host";

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
  const running = useWorldFinderSearch("town");
  const query = running?.query ?? "";
  const results = useMemo(
    () => townSearchResults(world, query),
    [query, world],
  );
  const [offscreen, setOffscreen] = useState(0);
  const open = query.trim() !== "";
  const chosen = running?.chosen ?? null;
  const keys = useMemo(
    () => results.map((result) => townSearchKey(office, result)),
    [results, office],
  );
  const chosenKey = chosen ? townSearchKey(office, chosen.result) : null;
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
  /** End the search: Town as it was, its camera back. */
  const clear = () => worldFinder.end("town");

  // Escape ends the search from the map too, not only from the toolbar. A
  // key something else took, such as putting back a carried desk, is left
  // alone.
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
      worldFinder.end("town");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);

  return {
    /** WorldViewToolbar's props. */
    toolbar: {
      query,
      resultLabel: open
        ? townSearchLabel(results.length, offscreen)
        : undefined,
      onClear: clear,
    },
    /** TownCanvas's search prop. */
    canvas: {
      search,
      onOffscreen: setOffscreen,
      onUnmapped: (key: string) => {
        // Nothing to show on the map: open it as selecting does.
        if (chosen && chosenKey === key && !townLandmarkKey(key))
          void onSelect(chosen.result.nodeId);
      },
    },
  };
}
