/**
 * Keeping the bus within reach: the part of the town's screen that no panel
 * covers (the asks rail, which on a phone floats over the lower town, and the
 * zoom column), so the stop's chip can tell when the stop is hidden and fly
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
      ".town-rail:not(.town-rail-collapsed), .town-rail-collapsed .town-rail-head, .town-zoom",
    ),
  ]
    .map((element) => element.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    }));
}
