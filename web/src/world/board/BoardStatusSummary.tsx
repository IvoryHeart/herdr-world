import { memo } from "react";
import type { BoardSquare } from "./boardModel";
import "./boardStatusSummary.css";

/** Large rooms keep every square, without a DOM node and animation per pane. */
export const BoardStatusSummary = memo(function BoardStatusSummary({
  squares,
  overview,
}: {
  squares: readonly BoardSquare[];
  overview: boolean;
}) {
  // Match the existing workspace's flex grid: 206px close up, 352px in overview.
  const size = overview ? 26 : 10;
  const gap = overview ? 10 : 5;
  const radius = overview ? 7 : 3;
  const columns = overview ? 10 : 14;
  const width = columns * (size + gap) - gap;
  const height = Math.ceil(squares.length / columns) * (size + gap) - gap;
  const paths = new Map<string, string>();
  const rounded = (x: number, y: number, side: number, r: number) => {
    const straight = side - 2 * r;
    return `M${x + r},${y}h${straight}a${r},${r} 0 0 1 ${r},${r}v${straight}a${r},${r} 0 0 1 -${r},${r}h-${straight}a${r},${r} 0 0 1 -${r},-${r}v-${straight}a${r},${r} 0 0 1 ${r},-${r}z`;
  };
  squares.forEach((square, i) => {
    const x = (i % columns) * (size + gap);
    const y = Math.floor(i / columns) * (size + gap);
    const key = square.isAgent ? `board-s-${square.status}` : "board-sq-shell";
    const shape =
      rounded(x, y, size, radius) +
      (square.isAgent ? "" : rounded(x + 2, y + 2, size - 4, radius - 2));
    paths.set(key, (paths.get(key) ?? "") + shape);
  });
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {[...paths].map(([key, d]) => (
        <path key={key} className={key} d={d} fillRule="evenodd" />
      ))}
    </svg>
  );
});
