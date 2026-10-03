import { describe, expect, test } from "bun:test";
import {
  graphViewportBounds,
  graphDrawingIntersects,
  hitGraphNode,
} from "./GraphCanvas";
import type { GraphLayoutNode } from "./graphLayout";
import type { WorldGraphNode } from "./graphProjection";

function layoutNode(
  id: string,
  kind: WorldGraphNode["kind"],
  x: number,
  y: number,
): GraphLayoutNode {
  return {
    id,
    kind,
    parentId: null,
    x,
    y,
    vx: 0,
    vy: 0,
    pinned: false,
    source: { id, kind } as WorldGraphNode,
  };
}

describe("Graph canvas hit testing", () => {
  test("culling keeps crossing edges and boundary labels through zoom, pan and quarter turns", () => {
    for (const rotation of [0, 1, 2, 3]) {
      const bounds = graphViewportBounds(
        800,
        600,
        { x: 0, y: 0, zoom: 2 },
        { x: 0, y: 0 },
        rotation,
      );
      expect(
        graphDrawingIntersects(
          bounds,
          { x: -1000, y: 0 },
          { x: 1000, y: 0 },
          0,
        ),
      ).toBe(true);
      expect(
        graphDrawingIntersects(bounds, { x: bounds.maxX + 80, y: 0 }),
      ).toBe(true);
      expect(
        graphDrawingIntersects(bounds, { x: bounds.maxX + 101, y: 0 }),
      ).toBe(false);
    }
    const panned = graphViewportBounds(
      800,
      600,
      { x: 2000, y: 0, zoom: 1 },
      { x: 0, y: 0 },
      0,
    );
    expect(graphDrawingIntersects(panned, { x: 0, y: 0 })).toBe(false);
    expect(graphDrawingIntersects(panned, { x: -2000, y: 0 })).toBe(true);
  });
  test("selects the visibly topmost leaf when a parent circle overlaps it", () => {
    const leaf = layoutNode("leaf", "terminal", 0, 0);
    const space = layoutNode("space", "space", 0, 44);

    expect(
      hitGraphNode(
        new Map([
          ["leaf", leaf],
          ["space", space],
        ]),
        0,
        0,
      ),
    ).toBe(leaf);
  });

  test("selects the last-painted leaf when peer circles overlap", () => {
    const first = layoutNode("first", "agent", 0, 0);
    const second = layoutNode("second", "terminal", 0, 0);

    expect(
      hitGraphNode(
        new Map([
          ["first", first],
          ["second", second],
        ]),
        0,
        0,
      ),
    ).toBe(second);
  });
});
