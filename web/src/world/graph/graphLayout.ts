import { stableNumber } from "../herdrOfficeProjection";
import type { HerdrGraphProjection, WorldGraphEdge, WorldGraphNode } from "./herdrGraphProjection";
import type { SavedGraphPosition } from "./graphViewPrefs";

export type GraphLayoutNode = {
  id: string;
  source: WorldGraphNode;
  kind: WorldGraphNode["kind"];
  parentId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
};

export type GraphLayoutState = {
  nodes: Map<string, GraphLayoutNode>;
  edges: WorldGraphEdge[];
  topologyKey: string;
};

export function reconcileGraphLayout(
  previous: GraphLayoutState | null,
  projection: HerdrGraphProjection,
  collapsedIds: ReadonlySet<string>,
  savedPositions: Readonly<Record<string, SavedGraphPosition>> = {},
) {
  const visibleNodes = projection.nodes.filter(
    (node) => node.kind === "space" || !node.parentId || !collapsedIds.has(node.parentId),
  );
  const visibleIds = new Set(visibleNodes.map(({ id }) => id));
  const edges = projection.edges.filter(
    ({ sourceId, targetId }) => visibleIds.has(sourceId) && visibleIds.has(targetId),
  );
  const topologyKey = JSON.stringify({
    nodes: visibleNodes.map(({ id }) => id).sort(),
    edges: edges.map(({ sourceId, targetId }) => [sourceId, targetId]).sort(compareEdgeIds),
  });
  const nodes = new Map<string, GraphLayoutNode>();
  const spaces = visibleNodes.filter(({ kind }) => kind === "space");
  for (const [index, source] of spaces.entries()) {
    nodes.set(source.id, reuseOrSeed(previous, source, index, spaces.length, savedPositions[source.id]));
  }
  for (const source of visibleNodes) {
    if (source.kind !== "terminal") {
      continue;
    }
    const parent = source.parentId ? nodes.get(source.parentId) : null;
    nodes.set(source.id, reuseOrSeedTerminal(previous, source, parent, savedPositions[source.id]));
  }
  return {
    state: { nodes, edges, topologyKey },
    topologyChanged: previous?.topologyKey !== topologyKey,
  };
}

export function stepGraphLayout(state: GraphLayoutState, alpha: number) {
  const spaces = [...state.nodes.values()].filter(({ kind }) => kind === "space");
  const terminalsByParent = new Map<string, GraphLayoutNode[]>();
  for (const node of state.nodes.values()) {
    if (node.kind === "terminal" && node.parentId) {
      const siblings = terminalsByParent.get(node.parentId) ?? [];
      siblings.push(node);
      terminalsByParent.set(node.parentId, siblings);
    }
  }

  for (let leftIndex = 0; leftIndex < spaces.length; leftIndex += 1) {
    const left = spaces[leftIndex];
    if (!left) continue;
    if (!left.pinned) {
      left.vx += -left.x * 0.0007 * alpha;
      left.vy += -left.y * 0.0007 * alpha;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < spaces.length; rightIndex += 1) {
      const right = spaces[rightIndex];
      if (!right) continue;
      repel(left, right, 230, 2.2, alpha);
    }
  }

  for (const [parentId, terminals] of terminalsByParent) {
    const parent = state.nodes.get(parentId);
    if (!parent) continue;
    for (let index = 0; index < terminals.length; index += 1) {
      const terminal = terminals[index];
      if (!terminal) continue;
      if (!terminal.pinned) {
        spring(terminal, parent, 110, 0.028, alpha);
      }
      for (let otherIndex = index + 1; otherIndex < terminals.length; otherIndex += 1) {
        const other = terminals[otherIndex];
        if (other) repel(terminal, other, 58, 1.5, alpha);
      }
    }
  }

  let energy = 0;
  for (const node of state.nodes.values()) {
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= 0.82;
    node.vy *= 0.82;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > 14) {
      node.vx = node.vx / speed * 14;
      node.vy = node.vy / speed * 14;
    }
    node.x += node.vx;
    node.y += node.vy;
    energy += Math.abs(node.vx) + Math.abs(node.vy);
  }
  return energy;
}

export function graphBounds(nodes: Iterable<GraphLayoutNode>) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const radius = node.kind === "space" ? 54 : 24;
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: -1, minY: -1, maxX: 1, maxY: 1 };
}

export function savedGraphPositions(state: GraphLayoutState | null) {
  const positions: Record<string, SavedGraphPosition> = {};
  if (!state) return positions;
  for (const node of state.nodes.values()) {
    positions[node.id] = { x: node.x, y: node.y, pinned: node.pinned };
  }
  return positions;
}

function reuseOrSeed(
  previous: GraphLayoutState | null,
  source: WorldGraphNode,
  index: number,
  count: number,
  saved: SavedGraphPosition | undefined,
) {
  const existing = previous?.nodes.get(source.id);
  if (existing) {
    existing.source = source;
    existing.parentId = source.parentId;
    return existing;
  }
  const angle = index * 2.399963229728653 + stableFraction(source.id);
  const radius = Math.max(100, Math.sqrt(Math.max(1, count)) * 74) * Math.sqrt((index + 1) / count);
  return layoutNode(source, saved?.x ?? Math.cos(angle) * radius, saved?.y ?? Math.sin(angle) * radius, saved?.pinned ?? false);
}

function reuseOrSeedTerminal(
  previous: GraphLayoutState | null,
  source: WorldGraphNode,
  parent: GraphLayoutNode | null | undefined,
  saved: SavedGraphPosition | undefined,
) {
  const existing = previous?.nodes.get(source.id);
  if (existing) {
    existing.source = source;
    existing.parentId = source.parentId;
    return existing;
  }
  const angle = stableFraction(source.id) * Math.PI * 2;
  return layoutNode(
    source,
    saved?.x ?? (parent?.x ?? 0) + Math.cos(angle) * 86,
    saved?.y ?? (parent?.y ?? 0) + Math.sin(angle) * 86,
    saved?.pinned ?? false,
  );
}

function layoutNode(source: WorldGraphNode, x: number, y: number, pinned: boolean): GraphLayoutNode {
  return { id: source.id, source, kind: source.kind, parentId: source.parentId, x, y, vx: 0, vy: 0, pinned };
}

function stableFraction(id: string) {
  return stableNumber(id) / 0xffffffff;
}

function compareEdgeIds(left: string[], right: string[]) {
  return left[0]?.localeCompare(right[0] ?? "") || left[1]?.localeCompare(right[1] ?? "") || 0;
}

function repel(
  left: GraphLayoutNode,
  right: GraphLayoutNode,
  distance: number,
  strength: number,
  alpha: number,
) {
  let dx = right.x - left.x;
  let dy = right.y - left.y;
  let length = Math.hypot(dx, dy);
  if (length < 0.01) {
    dx = stableFraction(left.id) - 0.5;
    dy = stableFraction(right.id) - 0.5;
    length = Math.max(0.01, Math.hypot(dx, dy));
  }
  if (length >= distance) return;
  const force = (distance - length) / distance * strength * alpha;
  const x = dx / length * force;
  const y = dy / length * force;
  if (!left.pinned) {
    left.vx -= x;
    left.vy -= y;
  }
  if (!right.pinned) {
    right.vx += x;
    right.vy += y;
  }
}

function spring(
  node: GraphLayoutNode,
  parent: GraphLayoutNode,
  distance: number,
  strength: number,
  alpha: number,
) {
  const dx = parent.x - node.x;
  const dy = parent.y - node.y;
  const length = Math.max(0.01, Math.hypot(dx, dy));
  const force = (length - distance) * strength * alpha;
  node.vx += dx / length * force;
  node.vy += dy / length * force;
  if (!parent.pinned) {
    parent.vx -= dx / length * force * 0.18;
    parent.vy -= dy / length * force * 0.18;
  }
}
