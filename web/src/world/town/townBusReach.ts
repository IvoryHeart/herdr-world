/**
 * Keeping the bus within reach: the part of the town's screen that no panel
 * covers (the asks rail, which on a phone floats over the lower town, the
 * zoom column and held-bus controls), so the stop's chip can tell when the stop is hidden and fly
 * the camera to put it where it can be pressed. Screen pixels, relative to
 * the town's canvas.
 */

export type ScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const area = (r: ScreenRect) =>
  Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

/**
 * The free part of `view`: for each panel over it, keep the largest of the
 * four sides of the panel (above, below, left of, right of it).
 */
export function freeScreenArea(
  view: ScreenRect,
  panels: readonly ScreenRect[],
): ScreenRect {
  let free = view;
  for (const panel of panels) {
    const overlaps =
      panel.left < free.right &&
      panel.right > free.left &&
      panel.top < free.bottom &&
      panel.bottom > free.top;
    if (!overlaps) continue;
    const sides: ScreenRect[] = [
      { ...free, bottom: Math.min(free.bottom, panel.top) },
      { ...free, top: Math.max(free.top, panel.bottom) },
      { ...free, right: Math.min(free.right, panel.left) },
      { ...free, left: Math.max(free.left, panel.right) },
    ];
    free = sides.reduce((best, side) =>
      area(side) > area(best) ? side : best,
    );
  }
  return free;
}

export const insideScreenArea = (outer: ScreenRect, inner: ScreenRect) =>
  inner.left >= outer.left &&
  inner.right <= outer.right &&
  inner.top >= outer.top &&
  inner.bottom <= outer.bottom;

/** The panels over the town now, relative to its canvas (`host`). */
export function townPanels(host: HTMLElement): ScreenRect[] {
  const origin = host.getBoundingClientRect();
  return [
    ...document.querySelectorAll<HTMLElement>(
      ".town-rail:not(.town-rail-collapsed), .town-rail-collapsed .town-rail-head, .town-zoom, .town-bus-held",
    ),
  ]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (!element.classList.contains("world-bin-tray")) return rect;
      // The common tray scales in. Reserve its final layout footprint from
      // the first frame, so a growing panel cannot cover the chip between HUD
      // frames. Keep the actual footprint too; no animation is suppressed.
      const style = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(
        style.transform === "none" ? undefined : style.transform,
      );
      const [x, y] = style.transformOrigin.split(" ").map(Number.parseFloat);
      const left = rect.left - (x ?? 0) * (1 - matrix.a) - matrix.e;
      const top = rect.top - (y ?? 0) * (1 - matrix.d) - matrix.f;
      return {
        left: Math.min(rect.left, left),
        top: Math.min(rect.top, top),
        right: Math.max(rect.right, left + element.offsetWidth),
        bottom: Math.max(rect.bottom, top + element.offsetHeight),
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    })
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    }));
}
