export type GraphPaintRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Integer device-pixel translations preserve the cached frame's sampling. */
export function graphPanStrips(
  width: number,
  height: number,
  dx: number,
  dy: number,
  density: number,
): GraphPaintRect[] | null {
  if (
    Math.abs(dx) >= width ||
    Math.abs(dy) >= height ||
    Math.abs(dx * density - Math.round(dx * density)) > 1e-6 ||
    Math.abs(dy * density - Math.round(dy * density)) > 1e-6
  )
    return null;
  const strips: GraphPaintRect[] = [];
  if (dx > 0) strips.push({ x: 0, y: 0, width: dx, height });
  if (dx < 0) strips.push({ x: width + dx, y: 0, width: -dx, height });
  if (dy > 0) strips.push({ x: 0, y: 0, width, height: dy });
  if (dy < 0) strips.push({ x: 0, y: height + dy, width, height: -dy });
  return strips;
}
