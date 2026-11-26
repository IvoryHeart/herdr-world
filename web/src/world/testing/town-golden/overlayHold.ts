/**
 * Town's DOM overlay (`.town-world`) follows the camera with a fractional
 * translate and scale. While the fixture settles, the camera moves through
 * 6,000 ms of test time in real task turns, so Chrome's compositor commits
 * land at load-dependent points of that motion. Chrome keeps raster-scale
 * history on each composited layer, so the same final transform could
 * rasterize the overlay's edges (the Add room doorway) one channel level
 * apart between page loads (#1289).
 *
 * The overlay still mounts, lays out and runs every production step during
 * the settle; it only stays unpainted. Revealing it at the checkpoint makes
 * Chrome create its layers once, at the final transform. `!important`
 * outranks the overlay's own inline and level-dependent visibility; removing
 * the rule restores the production cascade unchanged.
 */
export const TOWN_OVERLAY_HOLD_CSS =
  ".town-world, .town-world * { visibility: hidden !important; }";

type HoldDocument = {
  createElement(tag: "style"): { textContent: string | null; remove(): void };
  head: { append(node: unknown): void };
};

/** Real animation frames: the fixture's clock owns the page's own. */
type RealFrame = (callback: () => void) => unknown;

/** Holds the overlay unpainted; the returned reveal waits two real frames. */
export function holdTownOverlay(document: HoldDocument) {
  const style = document.createElement("style");
  style.textContent = TOWN_OVERLAY_HOLD_CSS;
  document.head.append(style);
  return async (frame: RealFrame) => {
    style.remove();
    await new Promise<void>((resolve) =>
      frame(() => {
        frame(() => resolve());
      }),
    );
  };
}
