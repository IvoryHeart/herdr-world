/**
 * The town center's ring on screen (TownCenterMenu.tsx): whether it is open,
 * where it sits as the camera moves, and the camera pans that bring the
 * center into view for keyboard focus or room for the ring.
 */

import { useRef, useState, type RefObject } from "react";
import { townCenterEmblem, type TownCenterLot } from "./townCenter";
import { placeTownCenterMenu, townCenterMenuPoint } from "./TownCenterMenu";
import { TOWN_TILE } from "./townLayout";
import type { TownRendererHandle } from "./townRenderer";

export function useTownCenterRing(
  rendererRef: RefObject<TownRendererHandle | null>,
  hostRef: RefObject<HTMLDivElement | null>,
  /** The center as laid out now. */
  center: () => TownCenterLot,
  /** Whether the ring has actions to offer. */
  enabled: boolean,
) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLElement | null>(null);
  const emblem = () => townCenterEmblem(center(), TOWN_TILE);
  /** The ring follows the center's doors on screen as the camera moves. */
  const place = (element = menu.current) => {
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!element || !renderer || !host) return;
    menu.current = element;
    const at = emblem();
    const point = renderer.camera.toScreen(at.x, at.y);
    placeTownCenterMenu(element, point, host.clientWidth, host.clientHeight);
  };
  /** Keyboard focus on the plaque pans an off-screen center into view. */
  const focus = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const { camera } = renderer;
    const at = emblem();
    const point = camera.toScreen(at.x, at.y);
    const { width, height } = camera.viewport;
    const margin = 120;
    if (
      point.x > margin &&
      point.y > margin &&
      point.x < width - margin &&
      point.y < height - margin
    )
      return;
    camera.flyTo(at.x, at.y, camera.z, 0.4);
    renderer.invalidate("focus");
  };
  /**
   * Open the ring. A center near the view's edge (the top of the town, under
   * the toolbar) first pans just far enough for the ring to sit on its doors.
   */
  const openRing = useRef<() => void>(() => undefined);
  openRing.current = () => {
    if (!enabled) return;
    setOpen(true);
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host) return;
    const { camera } = renderer;
    const at = emblem();
    const point = camera.toScreen(at.x, at.y);
    const fit = townCenterMenuPoint(point, host.clientWidth, host.clientHeight);
    const dx = (fit.x - point.x) / camera.z;
    const dy = (fit.y - point.y) / camera.z;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    camera.flyTo(camera.x - dx, camera.y - dy, camera.z, 0.3);
    renderer.invalidate("focus");
  };
  const close = () => {
    menu.current = null;
    setOpen(false);
  };
  /** Stable across renders, for handlers registered once. */
  const [openStable] = useState(() => () => openRing.current());
  return { open, place, focus, openRing: openStable, close };
}
