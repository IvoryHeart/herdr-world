import type { SavedGraphPosition } from "./graphPreferences";
import type {
  WorldGraphEdge,
  WorldGraphNode,
  WorldGraphProjection,
} from "./graphProjection";

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
  projection: WorldGraphProjection,
  collapsedIds: ReadonlySet<string>,
  savedPositions: Readonly<Record<string, SavedGraphPosition>> = {},
) {
  const hiddenIds = new Set<string>();
  const visibleNodes = projection.nodes.filter((node) => {
    if (
      node.parentId &&
      (hiddenIds.has(node.parentId) || collapsedIds.has(node.parentId))
    ) {
      hiddenIds.add(node.id);
      return false;
    }
    return true;
  });
  const visibleIds = new Set(visibleNodes.map(({ id }) => id));
  const edges = projection.edges.filter(
    ({ sourceId, targetId }) =>
      visibleIds.has(sourceId) && visibleIds.has(targetId),
  );
  const topologyKey = JSON.stringify({
    nodes: visibleNodes.map(({ id }) => id).sort(),
    edges: edges
      .map(({ sourceId, targetId }) => [sourceId, targetId])
      .sort(compareEdgeIds),
  });
  const nodes = new Map<string, GraphLayoutNode>();
  const hosts = visibleNodes.filter(({ kind }) => kind === "host");
  for (const [index, source] of hosts.entries()) {
    nodes.set(
      source.id,
      reuseOrSeed(
        previous,
        source,
        index,
        hosts.length,
        savedPositions[source.id],
      ),
    );
  }
  for (const source of visibleNodes) {
    if (source.kind === "host") continue;
    const parent = source.parentId ? nodes.get(source.parentId) : null;
    nodes.set(
      source.id,
      reuseOrSeedChild(previous, source, parent, savedPositions[source.id]),
    );
  }
  return {
    state: { nodes, edges, topologyKey },
    topologyChanged: previous?.topologyKey !== topologyKey,
  };
}

export function stepGraphLayout(state: GraphLayoutState, alpha: number) {
  const hosts = [...state.nodes.values()].filter(({ kind }) => kind === "host");
  const spaces = [...state.nodes.values()].filter(
    ({ kind }) => kind === "space",
  );
  const childrenByParent = new Map<string, GraphLayoutNode[]>();
  for (const node of state.nodes.values()) {
    if (node.kind === "host" || !node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  for (let leftIndex = 0; leftIndex < hosts.length; leftIndex += 1) {
    const left = hosts[leftIndex];
    if (!left) continue;
    if (!left.pinned) {
      left.vx += -left.x * 0.0007 * alpha;
      left.vy += -left.y * 0.0007 * alpha;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < hosts.length;
      rightIndex += 1
    ) {
      const right = hosts[rightIndex];
      if (right) repel(left, right, 620, 4, alpha);
    }
  }

  for (let leftIndex = 0; leftIndex < spaces.length; leftIndex += 1) {
    const left = spaces[leftIndex];
    if (!left) continue;
    for (const host of hosts) {
      if (left.parentId !== host.id) repel(left, host, 260, 2, alpha);
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < spaces.length;
      rightIndex += 1
    ) {
      const right = spaces[rightIndex];
      if (right) repel(left, right, 150, 1.8, alpha);
    }
  }

  for (const [parentId, children] of childrenByParent) {
    const parent = state.nodes.get(parentId);
    if (!parent) continue;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child) continue;
      if (!child.pinned) {
        spring(child, parent, child.kind === "space" ? 180 : 105, 0.028, alpha);
      }
      for (
        let otherIndex = index + 1;
        otherIndex < children.length;
        otherIndex += 1
      ) {
        const other = children[otherIndex];
        if (other) {
          repel(child, other, child.kind === "space" ? 120 : 58, 1.5, alpha);
        }
      }
    }
  }

  const allNodes = [...state.nodes.values()];
  for (let i = 0; i < allNodes.length; i++) {
    const a = allNodes[i]!;
    const ra = graphNodeRadius(a.kind) + LABEL_CLEARANCE;
    for (let j = i + 1; j < allNodes.length; j++) {
      const b = allNodes[j]!;
      if (a.parentId === b.id || b.parentId === a.id) continue;
      if (a.parentId !== null && a.parentId === b.parentId) continue;
      const rb = graphNodeRadius(b.kind) + LABEL_CLEARANCE;
      repel(a, b, ra + rb, 2.5, alpha);
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
      node.vx = (node.vx / speed) * 14;
      node.vy = (node.vy / speed) * 14;
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
    const radius = graphNodeRadius(node.kind);
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: -1, minY: -1, maxX: 1, maxY: 1 };
}

const LABEL_CLEARANCE = 18;

export function arrangeGraph(state: GraphLayoutState) {
  const nodes = [...state.nodes.values()];
  const hosts = nodes.filter(({ kind }) => kind === "host");
  const childrenByParent = new Map<string, GraphLayoutNode[]>();
  for (const n of nodes) {
    if (n.kind === "host" || !n.parentId) continue;
    const list = childrenByParent.get(n.parentId) ?? [];
    list.push(n);
    childrenByParent.set(n.parentId, list);
  }

  const hostCount = Math.max(1, hosts.length);
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]!;
    const angle = i * 2.399963229728653;
    const radius = Math.max(200, Math.sqrt(hostCount) * 160);
    host.x = Math.cos(angle) * radius;
    host.y = Math.sin(angle) * radius;
    host.vx = 0;
    host.vy = 0;
    host.pinned = false;
  }

  for (const [parentId, children] of childrenByParent) {
    const parent = state.nodes.get(parentId);
    if (!parent) continue;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const angle = (i / children.length) * Math.PI * 2;
      const dist = child.kind === "space" ? 180 : 105;
      child.x = parent.x + Math.cos(angle) * dist;
      child.y = parent.y + Math.sin(angle) * dist;
      child.vx = 0;
      child.vy = 0;
      child.pinned = false;
    }
  }

  separateOverlaps(nodes);
}

function separateOverlaps(nodes: GraphLayoutNode[]) {
  for (let pass = 0; pass < 12; pass++) {
    let displaced = false;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      const ra = graphNodeRadius(a.kind) + LABEL_CLEARANCE;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        const rb = graphNodeRadius(b.kind) + LABEL_CLEARANCE;
        const minDist = ra + rb;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 0.01) {
          dx = stableFraction(a.id) - 0.5;
          dy = stableFraction(b.id) - 0.5;
          dist = Math.max(0.01, Math.hypot(dx, dy));
        }
        const overlap = (minDist - dist) / 2 + 1;
        const nx = (dx / dist) * overlap;
        const ny = (dy / dist) * overlap;
        a.x -= nx;
        a.y -= ny;
        b.x += nx;
        b.y += ny;
        displaced = true;
      }
    }
    if (!displaced) break;
  }
}

export function savedGraphPositions(state: GraphLayoutState | null) {
  const positions: Record<string, SavedGraphPosition> = {};
  if (!state) return positions;
  for (const node of state.nodes.values()) {
    positions[node.id] = { x: node.x, y: node.y, pinned: node.pinned };
  }
  return positions;
}

export function graphNodeRadius(kind: WorldGraphNode["kind"]) {
  return kind === "host" ? 62 : kind === "space" ? 47 : 22;
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
  const radius =
    Math.max(100, Math.sqrt(Math.max(1, count)) * 74) *
    Math.sqrt((index + 1) / count);
  return layoutNode(
    source,
    saved?.x ?? Math.cos(angle) * radius,
    saved?.y ?? Math.sin(angle) * radius,
    saved?.pinned ?? false,
  );
}

function reuseOrSeedChild(
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
  const radius = source.kind === "space" ? 145 : 82;
  return layoutNode(
    source,
    saved?.x ?? (parent?.x ?? 0) + Math.cos(angle) * radius,
    saved?.y ?? (parent?.y ?? 0) + Math.sin(angle) * radius,
    saved?.pinned ?? false,
  );
}

function layoutNode(
  source: WorldGraphNode,
  x: number,
  y: number,
  pinned: boolean,
): GraphLayoutNode {
  return {
    id: source.id,
    source,
    kind: source.kind,
    parentId: source.parentId,
    x,
    y,
    vx: 0,
    vy: 0,
    pinned,
  };
}

function stableFraction(id: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function compareEdgeIds(left: string[], right: string[]) {
  return (
    left[0]?.localeCompare(right[0] ?? "") ||
    left[1]?.localeCompare(right[1] ?? "") ||
    0
  );
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
  const force = ((distance - length) / distance) * strength * alpha;
  const x = (dx / length) * force;
  const y = (dy / length) * force;
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
  node.vx += (dx / length) * force;
  node.vy += (dy / length) * force;
  if (!parent.pinned) {
    parent.vx -= (dx / length) * force * 0.18;
    parent.vy -= (dy / length) * force * 0.18;
  }
}
