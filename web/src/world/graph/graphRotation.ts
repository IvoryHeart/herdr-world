/** Clockwise quarter turns around the current layout center. */
export function rotateGraphPoint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  turns: number,
) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return { x: center.x - dy, y: center.y + dx };
    case 2:
      return { x: center.x - dx, y: center.y - dy };
    case 3:
      return { x: center.x + dy, y: center.y - dx };
    default:
      return { ...point };
  }
}

export function graphQuarterTurns(turns: number, direction: -1 | 1) {
  return (((turns + direction) % 4) + 4) % 4;
}
