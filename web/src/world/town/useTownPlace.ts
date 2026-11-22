import { createContext, useContext, useEffect } from "react";
import type { TownPlaceKey, TownPlaces } from "./townPlaces";

/** React side of Town's places (#1170); townPlaces.ts stays framework-free for the scene. */
export const TownPlacesContext = createContext<TownPlaces | null>(null);

/**
 * Registers `open` (null: nothing to open now) as what pressing the place's
 * building does. Pass a stable callback, or the latest is registered each
 * render.
 */
export function useTownPlace(key: TownPlaceKey, open: (() => void) | null) {
  const places = useContext(TownPlacesContext);
  useEffect(
    () => (places && open ? places.register(key, open) : undefined),
    [places, key, open],
  );
}
