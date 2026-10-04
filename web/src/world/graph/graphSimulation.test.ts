import { expect, test } from "bun:test";
import {
  createGraphSimulation,
  type GraphPhysicsNode,
} from "./graphSimulation";

test("spatial repulsion preserves the force law, ordering, overlaps and pins", () => {
  const nodes: GraphPhysicsNode[] = Array.from({ length: 240 }, (_, index) => ({
    id: `node-${index}`,
    kind: index < 40 ? "host" : index < 140 ? "space" : "agent",
    parentId:
      index < 40 ? null : index < 140 ? `node-${index % 40}` : "node-40",
    x: index % 7 === 0 ? 0 : (index % 17) * 150 - 1000,
    y: index % 7 === 0 ? 0 : Math.floor(index / 17) * 60 - 500,
    vx: 0,
    vy: 0,
    pinned: index % 11 === 0,
  }));
  const reference = structuredClone(nodes);
  const indexed = createGraphSimulation(nodes);
  const allPairs = createGraphSimulation(reference, false);
  for (let tick = 0; tick < 20; tick++) {
    expect(indexed.step(0.9 ** tick)).toBe(allPairs.step(0.9 ** tick));
    expect(nodes).toEqual(reference);
  }
});
