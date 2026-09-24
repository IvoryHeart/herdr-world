import { describe, expect, test } from "bun:test";
import { hitGraphNode } from "./GraphCanvas";
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
