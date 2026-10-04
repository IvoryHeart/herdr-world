import { expect, test } from "bun:test";
import { GraphSimulationRunner } from "./graphSimulationRunner";
import type { GraphLayoutState } from "./graphLayout";
import type { GraphPhysicsNode } from "./graphSimulation";

function layout(): GraphLayoutState {
  const nodes: GraphPhysicsNode[] = [0, 1].map((index) => ({
    id: `host-${index}`,
    kind: "host",
    parentId: null,
    x: index * 10,
    y: 0,
    vx: 0,
    vy: 0,
    pinned: false,
  }));
  // The runner deliberately accepts geometry without consulting source records.
  return {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: [],
    topologyKey: "hosts",
  } as unknown as GraphLayoutState;
}

test("physics replies are single-flight and fenced across reset and disposal", () => {
  const OriginalWorker = globalThis.Worker;
  const messages: {
    revision: number;
    alpha?: number;
    nodes?: GraphPhysicsNode[];
    pin?: { id: string; x: number; y: number };
  }[] = [];
  const workers: StubWorker[] = [];
  class StubWorker {
    onmessage?: (event: {
      data: { revision: number; positions: Float64Array; alpha: number };
    }) => void;
    onerror?: () => void;
    terminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage(message: (typeof messages)[number]) {
      messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
  }
  globalThis.Worker = StubWorker as unknown as typeof Worker;
  const results: number[] = [];
  const runner = new GraphSimulationRunner((alpha) => results.push(alpha));
  try {
    const previous = layout();
    runner.reset(previous);
    runner.step(1);
    runner.step(0.5);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.nodes![0]).not.toHaveProperty("source");
    const revision = messages[0]!.revision;
    const current = layout();
    runner.reset(current);
    runner.step(1);
    const reply = (revision: number, alpha = 0.5) =>
      workers[0]!.onmessage!({
        data: {
          revision,
          alpha,
          positions: new Float64Array([20, 21, 1, 2, 30, 31, 3, 4]),
        },
      });
    reply(revision);
    expect(results).toEqual([]);
    expect(current.nodes.get("host-0")!.x).toBe(0);
    reply(messages[2]!.revision);
    expect(results).toEqual([0.5]);
    expect(current.nodes.get("host-0")!.x).toBe(20);
    expect(previous.nodes.get("host-0")!.x).toBe(0);
    runner.step(0.5);
    const priorMessages = messages.length;
    for (let index = 0; index < 20; index++)
      runner.pin("host-0", 100 + index, 200 + index);
    expect(messages.slice(priorMessages)).toHaveLength(20);
    expect(
      messages
        .slice(priorMessages)
        .every(
          (message) =>
            message.pin &&
            !message.nodes &&
            message.revision === messages[2]!.revision,
        ),
    ).toBe(true);
    current.nodes.get("host-1")!.x = 999;
    reply(messages[2]!.revision, 0);
    expect(results).toEqual([0.5, 0.24]);
    expect(current.nodes.get("host-0")!.x).toBe(119);
    expect(current.nodes.get("host-0")!.y).toBe(219);
    expect(current.nodes.get("host-0")!.vx).toBe(0);
    expect(current.nodes.get("host-1")!.x).toBe(30);
    runner.step(0.5);
    runner.dispose();
    reply(messages[2]!.revision, 0);
    expect(results).toEqual([0.5, 0.24]);
    expect(workers[0]!.terminated).toBe(true);
  } finally {
    runner.dispose();
    globalThis.Worker = OriginalWorker;
  }
});

test("unavailable workers use yielding physics and disposal cancels queued fallback work", async () => {
  const OriginalWorker = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      throw Error("worker unavailable");
    }
  } as unknown as typeof Worker;
  const result = Promise.withResolvers<number>();
  let replies = 0;
  const runner = new GraphSimulationRunner((alpha) => {
    replies++;
    result.resolve(alpha);
  });
  try {
    const current = layout();
    runner.reset(current);
    runner.step(1, true);
    runner.pin("host-0", 125, 225);
    expect(runner.offThread).toBe(false);
    expect(replies).toBe(0);
    expect(await result.promise).toBe(0.24);
    expect(current.nodes.get("host-0")!.x).toBe(125);
    expect(current.nodes.get("host-0")!.y).toBe(225);
    expect(current.nodes.get("host-1")!.x).not.toBe(10);
    runner.step(1);
    runner.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(replies).toBe(1);
  } finally {
    runner.dispose();
    globalThis.Worker = OriginalWorker;
  }
});
