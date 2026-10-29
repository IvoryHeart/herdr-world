import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardStatusSummary } from "./BoardStatusSummary";
import type { BoardSquare } from "./boardModel";

test("dense room summaries preserve every agent and hollow shell with bounded drawing nodes", () => {
  const squares: BoardSquare[] = Array.from({ length: 255 }, (_, i) => ({
    status: (["blocked", "working", "done", "idle", "unknown"] as const)[
      i % 5
    ]!,
    isAgent: i % 7 !== 0,
  }));
  for (const overview of [false, true]) {
    const markup = renderToStaticMarkup(
      <BoardStatusSummary squares={squares} overview={overview} />,
    );
    expect(markup.match(/<path /g)).toHaveLength(6);
    // Each shell has an outer and inner contour; every agent has one.
    expect(markup.match(/M[0-9]/g)).toHaveLength(
      squares.length + squares.filter((s) => !s.isAgent).length,
    );
    expect(markup).toContain('fill-rule="evenodd"');
    expect(markup).toContain('class="board-s-working"');
    expect(markup).toContain(
      overview ? 'viewBox="0 0 350 926"' : 'viewBox="0 0 205 280"',
    );
  }
});
