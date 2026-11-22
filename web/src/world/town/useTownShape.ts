/**
 * Town's shape: from its container's size and the Rooms per row setting
 * (#1188). A resize or a new setting gives a new shape only when the shape's
 * key changes, so an unchanged shape keeps its placement memory and camera.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { worldLocalStorage } from "../../browserStorage";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
} from "../officePreferences";
import { townShapeFor, townShapeKey, type TownShape } from "./townLayout";

const roomsPerRow = () =>
  readOfficePreferences(worldLocalStorage).townRoomsPerRow;

export function useTownShape(): [
  TownShape,
  (width: number, height: number) => void,
] {
  // Before the container is measured, the window stands in for it.
  const size = useRef(
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1440, height: 900 },
  );
  const setting = useRef(roomsPerRow());
  const [shape, setShape] = useState<TownShape>(() =>
    townShapeFor(size.current.width, size.current.height, setting.current),
  );
  const refit = useCallback(() => {
    const fit = townShapeFor(
      size.current.width,
      size.current.height,
      setting.current,
    );
    setShape((was) => (townShapeKey(was) === townShapeKey(fit) ? was : fit));
  }, []);
  // The setting applies live, as the other Town layout settings do.
  useEffect(() => {
    const changed = () => {
      setting.current = roomsPerRow();
      refit();
    };
    window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, changed);
    return () =>
      window.removeEventListener(
        WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
        changed,
      );
  }, [refit]);
  const fit = useCallback(
    (width: number, height: number) => {
      size.current = { width, height };
      refit();
    },
    [refit],
  );
  return [shape, fit];
}
