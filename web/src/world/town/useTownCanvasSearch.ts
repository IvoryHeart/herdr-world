/**
 * A search on Town's canvas (#159): what it lights up, how many of its
 * matches are off-screen, and the camera's trip to a chosen match and back
 * when the search ends.
 */

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { TownSceneCamera } from "./scene/townSceneCamera";
import type { TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import {
  townRectOnScreen,
  townSearchLight,
  townSearchOffscreen,
  townSearchRect,
} from "./townSearch";

/**
 * A search's matches on the map, by Town key (one per result), and the
 * chosen one to show and pulse (a new `seq` asks again). Null when no search
 * is open; ending one returns the camera it moved.
 */
export type TownCanvasSearch = {
  keys: readonly string[];
  chosen: { key: string; seq: number } | null;
} | null;

/** TownCanvas's search prop: the matches and what the map reports back. */
export type TownCanvasSearchProps = {
  search: TownCanvasSearch;
  /** How many matches are off-screen, when that changes. */
  onOffscreen?: (count: number) => void;
  /** A chosen match Town does not draw, so it cannot be shown. */
  onUnmapped?: (key: string) => void;
};

export function useTownCanvasSearch(
  props: TownCanvasSearchProps | undefined,
  {
    model,
    layout,
    view,
    renderer,
    ready,
    failure,
    calm,
  }: {
    model: TownModel;
    layout: TownLayout;
    view: TownSceneCamera;
    renderer: RefObject<TownRendererHandle | null>;
    ready: boolean;
    failure: boolean;
    calm: boolean;
  },
) {
  const { search = null, onOffscreen, onUnmapped } = props ?? {};
  const light = useMemo(
    () => (search ? townSearchLight(model, search.keys, search.chosen) : null),
    [model, search],
  );
  const latest = useRef({
    search,
    model,
    layout,
    calm,
    onOffscreen,
    onUnmapped,
  });
  latest.current = { search, model, layout, calm, onOffscreen, onUnmapped };

  /** The count last reported, so only changes are. */
  const sent = useRef<number | null>(null);
  const countOffscreen = useRef(() => {
    const {
      search: shown,
      onOffscreen: report,
      model: m,
      layout: l,
    } = latest.current;
    const drawn = renderer.current;
    if (!shown || !report || !drawn) return;
    const count = townSearchOffscreen(
      shown.keys,
      (key) =>
        townSearchRect(key, m, l, (agentKey) => drawn.actorPosition(agentKey)),
      (rect) => townRectOnScreen(rect, drawn.camera),
    );
    if (count === sent.current) return;
    sent.current = count;
    report(count);
  }).current;

  // A new search or layout counts its matches again; the camera's frames do
  // as it moves (countOffscreen).
  useEffect(() => {
    if (!search) sent.current = null;
    else if (ready) countOffscreen();
  }, [search, ready, layout, countOffscreen]);

  // A chosen match flies the camera to it, once per choice however often the
  // town changes meanwhile; ending the search flies back.
  const searching = search !== null;
  const chosen = search?.chosen ?? null;
  const shown = useRef<number | null>(null);
  useEffect(() => {
    const drawn = renderer.current;
    const {
      model: m,
      layout: l,
      calm: still,
      onUnmapped: unmapped,
    } = latest.current;
    if (!searching) {
      if (ready) view.searchEnd(still);
      return;
    }
    if (!chosen || shown.current === chosen.seq) return;
    if (failure) {
      shown.current = chosen.seq;
      unmapped?.(chosen.key);
      return;
    }
    if (!ready || !drawn) return;
    shown.current = chosen.seq;
    const rect = townSearchRect(chosen.key, m, l, (agentKey) =>
      drawn.actorPosition(agentKey),
    );
    if (rect) view.searchFocus(chosen, rect, l, still);
    else unmapped?.(chosen.key);
  }, [view, renderer, ready, failure, searching, chosen]);

  return { light, countOffscreen };
}
