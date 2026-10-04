import { createGraphSimulation } from "./graphSimulation";
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

const simulations = new WeakMap<
  GraphLayoutState,
  ReturnType<typeof createGraphSimulation>
>();

export function stepGraphLayout(state: GraphLayoutState, alpha: number) {
  let simulation = simulations.get(state);
  if (!simulation) {
    simulation = createGraphSimulation([...state.nodes.values()]);
    simulations.set(state, simulation);
  }
  return simulation.step(alpha);
}

export function arrangeGraphLayout(state: GraphLayoutState) {
  const children = new Map<string, GraphLayoutNode[]>();
  for (const node of state.nodes.values()) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const hosts = [...state.nodes.values()].filter(({ kind }) => kind === "host");
  const hostRows = hosts.map((host) => {
    const spaces = children.get(host.id) ?? [];
    const rows: { spaces: GraphLayoutNode[]; width: number; height: number }[] =
      [];
    for (let index = 0; index < spaces.length; index += 3) {
      const rowSpaces = spaces.slice(index, index + 3);
      rows.push({
        spaces: rowSpaces,
        width: rowSpaces.reduce((sum, space) => sum + spaceWidth(space), 0),
        height: Math.max(...rowSpaces.map((space) => spaceHeight(space))),
      });
    }
    return {
      host,
      rows,
      width: Math.max(220, ...rows.map(({ width }) => width)),
      height: rows.reduce((sum, row) => sum + row.height + 80, 220),
    };
  });
  const hostColumns = Math.ceil(Math.sqrt(hostRows.length));
  const layoutRows = [];
  for (let index = 0; index < hostRows.length; index += hostColumns) {
    const rowHosts = hostRows.slice(index, index + hostColumns);
    layoutRows.push({
      hosts: rowHosts,
      width:
        rowHosts.reduce((sum, host) => sum + host.width, 0) +
        (rowHosts.length - 1) * 160,
      height: Math.max(...rowHosts.map(({ height }) => height)),
    });
  }
  const totalHeight =
    layoutRows.reduce((sum, row) => sum + row.height, 0) +
    Math.max(0, layoutRows.length - 1) * 160;
  let hostTop = -totalHeight / 2;
  for (const layoutRow of layoutRows) {
    let hostLeft = -layoutRow.width / 2;
    for (const { host, rows, width } of layoutRow.hosts) {
      place(host, hostLeft + width / 2, hostTop);
      let rowTop = hostTop + 220;
      for (const row of rows) {
        let spaceLeft = hostLeft + (width - row.width) / 2;
        for (const space of row.spaces) {
          const cellWidth = spaceWidth(space);
          const spaceX = spaceLeft + cellWidth / 2;
          place(space, spaceX, rowTop);
          const leaves = children.get(space.id) ?? [];
          const columns = Math.min(4, leaves.length);
          for (const [index, leaf] of leaves.entries()) {
            place(
              leaf,
              spaceX + ((index % 4) - (columns - 1) / 2) * 112,
              rowTop + 140 + Math.floor(index / 4) * 96,
            );
          }
          spaceLeft += cellWidth;
        }
        rowTop += row.height + 80;
      }
      hostLeft += width + 160;
    }
    hostTop += layoutRow.height + 160;
  }

  function spaceWidth(space: GraphLayoutNode) {
    return Math.max(
      180,
      Math.min(4, children.get(space.id)?.length ?? 0) * 112 + 48,
    );
  }

  function spaceHeight(space: GraphLayoutNode) {
    return Math.max(
      190,
      140 + Math.ceil((children.get(space.id)?.length ?? 0) / 4) * 96,
    );
  }

  function place(node: GraphLayoutNode, x: number, y: number) {
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
    // Layout updates restart the force pass; arranged positions stay fixed.
    node.pinned = true;
  }
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
