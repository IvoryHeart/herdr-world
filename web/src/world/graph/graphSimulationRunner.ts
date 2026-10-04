import { yieldWorldTask } from "../worldObject";
import type { GraphLayoutState } from "./graphLayout";
import {
  createGraphSimulation,
  type GraphPhysicsNode,
} from "./graphSimulation";

// The kernel is self-contained: bundling/minification leaves no imported names
// inside its body. The worker receives geometry only, never runtime/session data.
function workerSource() {
  return `const createSimulation = ${createGraphSimulation.toString()};
let revision = 0, nodes = [], byId = new Map(), simulation;
self.onmessage = ({ data }) => {
  if (data.nodes) {
    revision = data.revision; nodes = data.nodes;
    byId = new Map(nodes.map(node => [node.id, node]));
    simulation = createSimulation(nodes); return;
  }
  if (!simulation || revision !== data.revision) return;
  if (data.pin) {
    const node = byId.get(data.pin.id);
    if (node) Object.assign(node, data.pin, { pinned: true, vx: 0, vy: 0 });
    return;
  }
  let alpha = data.alpha;
  do {
    const energy = simulation.step(alpha);
    alpha *= energy < 0.08 ? 0.78 : 0.93;
  } while (data.settle && alpha > 0.015);
  const positions = new Float64Array(nodes.length * 4);
  nodes.forEach((node, index) => positions.set([node.x, node.y, node.vx, node.vy], index * 4));
  self.postMessage({ revision, alpha, positions }, [positions.buffer]);
};`;
}

/** One in-flight physics step; topology generations fence stale replies. */
export class GraphSimulationRunner {
  #worker: Worker | null = null;
  #url: string | null = null;
  #nodes: GraphPhysicsNode[] = [];
  #byId = new Map<string, GraphPhysicsNode>();
  #simulation: ReturnType<typeof createGraphSimulation> | null = null;
  #revision = 0;
  #pending = false;
  #reheatAlpha = 0;
  #disposed = false;
  #lastRequest = { alpha: 0, settle: false };

  get offThread() {
    return this.#worker !== null;
  }

  constructor(private readonly onResult: (alpha: number) => void) {
    try {
      this.#url = URL.createObjectURL(
        new Blob([workerSource()], { type: "text/javascript" }),
      );
      this.#worker = new Worker(this.#url);
      this.#worker.onmessage = ({ data }) => {
        if (
          this.#disposed ||
          data.revision !== this.#revision ||
          !this.#pending
        )
          return;
        if (
          !(data.positions instanceof Float64Array) ||
          data.positions.length !== this.#nodes.length * 4
        )
          return this.#fallback();
        this.#nodes.forEach((node, index) => {
          // A drag may have advanced since this step began. Pinned positions
          // remain main-thread authoritative without discarding neighbours.
          if (node.pinned) return;
          [node.x, node.y, node.vx, node.vy] = data.positions.subarray(
            index * 4,
            index * 4 + 4,
          );
        });
        this.#complete(data.alpha);
      };
      this.#worker.onerror = () => this.#fallback();
    } catch {
      this.#fallback();
    }
  }

  reset(state: GraphLayoutState) {
    this.#revision++;
    this.#pending = false;
    this.#reheatAlpha = 0;
    this.#nodes = [...state.nodes.values()];
    this.#byId = new Map(this.#nodes.map((node) => [node.id, node]));
    this.#simulation = null;
    this.#worker?.postMessage({
      revision: this.#revision,
      nodes: this.#nodes.map(
        ({ id, kind, parentId, x, y, vx, vy, pinned }) => ({
          id,
          kind,
          parentId,
          x,
          y,
          vx,
          vy,
          pinned,
        }),
      ),
    });
  }

  pin(id: string, x: number, y: number) {
    if (this.#disposed) return;
    const node = this.#byId.get(id);
    if (!node) return;
    Object.assign(node, { x, y, pinned: true, vx: 0, vy: 0 });
    // A reply already in transit may have settled before this position changed.
    this.#reheatAlpha = 0.24;
    this.#worker?.postMessage({ revision: this.#revision, pin: { id, x, y } });
  }

  step(alpha: number, settle = false) {
    if (this.#disposed || this.#pending || !this.#nodes.length) return;
    this.#pending = true;
    this.#lastRequest = { alpha, settle };
    if (this.#worker) {
      this.#worker.postMessage({ revision: this.#revision, alpha, settle });
      return;
    }
    const revision = this.#revision;
    this.#simulation ??= createGraphSimulation(this.#nodes);
    const simulation = this.#simulation;
    void (async () => {
      do {
        await yieldWorldTask();
        if (this.#disposed || revision !== this.#revision) return;
        const energy = simulation.step(alpha);
        alpha *= energy < 0.08 ? 0.78 : 0.93;
      } while (settle && alpha > 0.015);
      this.#complete(alpha);
    })();
  }

  #complete(alpha: number) {
    this.#pending = false;
    const nextAlpha = Math.max(alpha, this.#reheatAlpha);
    this.#reheatAlpha = 0;
    this.onResult(nextAlpha);
  }

  #fallback() {
    this.#worker?.terminate();
    this.#worker = null;
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = null;
    if (this.#pending && !this.#disposed) {
      this.#pending = false;
      this.step(this.#lastRequest.alpha, this.#lastRequest.settle);
    }
  }

  dispose() {
    this.#disposed = true;
    this.#revision++;
    this.#fallback();
    this.#nodes = [];
    this.#byId.clear();
    this.#simulation = null;
  }
}
