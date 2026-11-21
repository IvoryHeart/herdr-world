import { useEffect, type RefObject } from "react";
import { HELP_REVEAL_EVENT } from "../../help/helpTry";
import type { TownCamera } from "./townCamera";
import type { TownRendererHandle } from "./townRenderer";

/** How far inside the usable view a control counts as in view. */
const MARGIN = 48;

/**
 * Where the camera centres to bring the screen box `box` (host pixels) into
 * the usable view, or null when it is in view already.
 */
export function townHelpRevealPoint(
  camera: Pick<TownCamera, "viewport" | "toWorld">,
  box: { left: number; top: number; right: number; bottom: number },
) {
  const { width, height, inset } = camera.viewport;
  if (
    box.left >= inset.left + MARGIN &&
    box.top >= inset.top + MARGIN &&
    box.right <= width - inset.right - MARGIN &&
    box.bottom <= height - inset.bottom - MARGIN
  )
    return null;
  return camera.toWorld((box.left + box.right) / 2, (box.top + box.bottom) / 2);
}

/**
 * Help's Try (helpTry.ts) on a Town control: Town is a clipped stage the
 * camera moves, so a control painted off camera (the Apartments sign below
 * a phone's first view) is flown into view, at the same zoom, rather than
 * scrolled; the controls over the scene are never scrolled either.
 * Scrolling the shell would lift the controls off their painted
 * buildings and leave the bottom of the screen blank.
 */
export function useTownHelpReveal(
  hostRef: RefObject<HTMLElement | null>,
  rendererRef: RefObject<TownRendererHandle | null>,
) {
  useEffect(() => {
    // The canvas host's parent is Town's shell, which holds every control.
    const shell = hostRef.current?.parentElement;
    if (!shell) return;
    const onReveal = (event: Event) => {
      const renderer = rendererRef.current;
      const host = hostRef.current;
      const target = event.target;
      // Without a drawn town the browser's own scroll is all there is.
      if (!renderer || !host || !(target instanceof Element)) return;
      event.preventDefault();
      // Controls over the scene (zoom, the board chip) stay on screen.
      if (!target.closest(".town-world")) return;
      const origin = host.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const at = townHelpRevealPoint(renderer.camera, {
        left: box.left - origin.left,
        top: box.top - origin.top,
        right: box.right - origin.left,
        bottom: box.bottom - origin.top,
      });
      if (!at) return;
      renderer.camera.flyTo(at.x, at.y, renderer.camera.z, 0.4);
      renderer.invalidate("help");
    };
    shell.addEventListener(HELP_REVEAL_EVENT, onReveal);
    return () => shell.removeEventListener(HELP_REVEAL_EVENT, onReveal);
  }, [hostRef, rendererRef]);
}
