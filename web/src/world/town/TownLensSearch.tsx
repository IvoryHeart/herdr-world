/**
 * A search's marks while a Town lens is on (#784): each match's outline and
 * the chosen match's pulse, drawn in the lens layer above its dim and tints,
 * so a match stands out and every other place keeps its lens colour. The
 * canvas still dims what the search did not find, under the lens; without a
 * lens the canvas draws the marks (townSelectionEffects.ts). Agents walk, so
 * the marks are placed again on each frame the canvas draws.
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import type { TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import {
  townSearchRect,
  type TownActorPosition,
  type TownSearchLight,
} from "./townSearch";

/** What the lens layer needs of Town's canvas search (useTownCanvasSearch). */
export type TownLensSearchSource = {
  light: TownSearchLight | null;
  actorPosition: TownActorPosition;
  /** Calls `place` on each frame drawn; returns the way to stop. */
  follow(place: () => void): () => void;
};

/** World-pixel placement: the rectangle, or hidden when Town does not draw it. */
function place(element: HTMLElement, rect: ReturnType<typeof townSearchRect>) {
  const style = element.style;
  if (!rect) {
    style.display = "none";
    return;
  }
  style.display = "";
  style.left = `${rect.x}px`;
  style.top = `${rect.y}px`;
  style.width = `${rect.w}px`;
  style.height = `${rect.h}px`;
}

export function TownLensSearch({
  search,
  model,
  layout,
}: {
  search: TownLensSearchSource;
  model: TownModel;
  layout: TownLayout;
}) {
  const { light, actorPosition, follow } = search;
  const marks = useRef(new Map<string, HTMLElement>());
  const pulse = useRef<HTMLElement | null>(null);
  const placeAll = useCallback(() => {
    const rectOf = (key: string) =>
      townSearchRect(key, model, layout, actorPosition);
    for (const [key, element] of marks.current) place(element, rectOf(key));
    if (pulse.current && light?.pulse)
      place(pulse.current, rectOf(light.pulse.key));
  }, [light, model, layout, actorPosition]);
  useLayoutEffect(() => {
    placeAll();
    return follow(placeAll);
  }, [placeAll, follow]);
  // No match leaves the lens as it is: "No matches" says so.
  if (!light?.keys.size) return null;
  return (
    <div className="town-lens-search">
      {[...light.keys].map((key) => (
        <i
          key={key}
          className="town-lens-search-mark"
          data-key={key}
          ref={(element) => {
            if (element) marks.current.set(key, element);
            else marks.current.delete(key);
          }}
        />
      ))}
      {light.pulse ? (
        // A new choice is a new element, so its pulse plays again.
        <i
          key={`pulse-${light.pulse.seq}`}
          className="town-lens-search-pulse"
          data-key={light.pulse.key}
          ref={pulse}
        />
      ) : null}
    </div>
  );
}
