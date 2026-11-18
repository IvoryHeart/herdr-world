/**
 * Town's census on the map (#980): the count you chose lights what it
 * counts through Town's search light (useTownCanvasSearch), live as the
 * town changes. **Next** shows its places one at a time, as choosing a
 * search result does; choosing the count again, ✕, Escape or typing a
 * search ends it, and the camera returns as after a search.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfilesDocument } from "../agentProfiles";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { WorldObject } from "../worldObject";
import { askingKeysForWorld } from "../worldAskTargets";
import {
  townCensus,
  townCensusItem,
  type TownCensus,
  type TownCensusItem,
} from "./townCensus";
import type { TownSummary } from "./townSummary";
import type { TownCanvasSearch } from "./useTownCanvasSearch";

export type TownCensusControl = {
  census: TownCensus;
  /** The lit count as it is now; null when none is. */
  lit: TownCensusItem | null;
  /** Light a count, or end it when it is the lit one. */
  show(id: string): void;
  clear(): void;
  /** Show the lit count's next place on the map. */
  next(): void;
  /** How many of the lit count's places are off-screen. */
  offscreen: number;
  setOffscreen(count: number): void;
  /** The canvas search light while a count is lit. */
  light: TownCanvasSearch;
};

/** Where Escape ends a lit count: the map, the board and its phone chip. */
const ESCAPE_SCOPE = ".town-canvas-host, .town-board, .town-census-chip";

export function useTownCensus({
  world,
  office,
  summary,
  profiles,
}: {
  world: Pick<WorldObject, "leaves">;
  office: HerdrOfficeProjection;
  summary: TownSummary;
  /** World's agent profiles, whose skills launched agents carry. */
  profiles: ProfilesDocument | null;
}): TownCensusControl {
  const census = useMemo(
    () =>
      townCensus(
        office,
        summary,
        askingKeysForWorld(summary.asks, world),
        profiles,
      ),
    [office, summary, world, profiles],
  );
  const [litId, setLitId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ key: string; seq: number } | null>(
    null,
  );
  const seq = useRef(0);
  const [offscreen, setOffscreen] = useState(0);
  const lit = litId === null ? null : townCensusItem(census, litId);
  const keys = lit?.keys ?? null;
  const shownKey = chosen && keys?.includes(chosen.key) ? chosen : null;
  const light = useMemo(
    () => (keys ? { keys, chosen: shownKey } : null),
    [keys, shownKey],
  );
  const clear = () => {
    setLitId(null);
    setChosen(null);
  };

  useEffect(() => {
    if (litId === null) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && target !== document.body && !target.closest(ESCAPE_SCOPE))
        return;
      event.preventDefault();
      setLitId(null);
      setChosen(null);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [litId]);

  return {
    census,
    lit,
    show: (id) => {
      setChosen(null);
      setLitId((current) => (current === id ? null : id));
    },
    clear,
    next: () => {
      if (!keys?.length) return;
      const at = shownKey ? keys.indexOf(shownKey.key) : -1;
      seq.current += 1;
      setChosen({ key: keys[(at + 1) % keys.length]!, seq: seq.current });
    },
    offscreen,
    setOffscreen,
    light,
  };
}
