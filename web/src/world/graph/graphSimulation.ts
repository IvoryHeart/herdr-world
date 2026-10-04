/** Self-contained physics kernel: shared by the renderer fallback and worker. */
export type GraphPhysicsNode = {
  id: string;
  kind: "host" | "space" | "agent" | "terminal";
  parentId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
};

export function createGraphSimulation(
  nodes: GraphPhysicsNode[],
  spatial = true,
) {
  const state = { nodes: new Map(nodes.map((node) => [node.id, node])) };
  const hosts = [...state.nodes.values()].filter(({ kind }) => kind === "host");
  const spaces = [...state.nodes.values()].filter(
    ({ kind }) => kind === "space",
  );
  const childrenByParent = new Map<string, GraphPhysicsNode[]>();
  for (const node of state.nodes.values()) {
    if (node.kind === "host" || !node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  function stableFraction(id: string) {
    let hash = 2_166_136_261;
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0) / 0xffffffff;
  }

  function repel(
    left: GraphPhysicsNode,
    right: GraphPhysicsNode,
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
    node: GraphPhysicsNode,
    parent: GraphPhysicsNode,
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

  function neighbours(items: GraphPhysicsNode[], radius: number) {
    if (!spatial || items.length < 32)
      return (_node: GraphPhysicsNode, after = -1) =>
        items.map((_, index) => index).slice(after + 1);
    const cells = new Map<string, number[]>();
    items.forEach((node, index) => {
      const key = `${Math.floor(node.x / radius)},${Math.floor(node.y / radius)}`;
      const cell = cells.get(key) ?? [];
      cell.push(index);
      cells.set(key, cell);
    });
    return (node: GraphPhysicsNode, after = -1) => {
      const x = Math.floor(node.x / radius),
        y = Math.floor(node.y / radius);
      const result: number[] = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const index of cells.get(`${x + dx},${y + dy}`) ?? [])
            if (index > after) result.push(index);
      // Keep the original pair order: the force law and numerical evolution stay
      // identical, only pairs outside its finite interaction radius are skipped.
      return result.sort((a, b) => a - b);
    };
  }

  return {
    step(alpha: number) {
      const hostGrid = neighbours(hosts, 620);
      const foreignHostGrid = neighbours(hosts, 260);
      const spaceGrid = neighbours(spaces, 150);
      for (let leftIndex = 0; leftIndex < hosts.length; leftIndex += 1) {
        const left = hosts[leftIndex];
        if (!left) continue;
        if (!left.pinned) {
          left.vx += -left.x * 0.0007 * alpha;
          left.vy += -left.y * 0.0007 * alpha;
        }
        for (const rightIndex of hostGrid(left, leftIndex)) {
          const right = hosts[rightIndex];
          if (right) repel(left, right, 620, 4, alpha);
        }
      }

      for (let leftIndex = 0; leftIndex < spaces.length; leftIndex += 1) {
        const left = spaces[leftIndex];
        if (!left) continue;
        for (const hostIndex of foreignHostGrid(left)) {
          const host = hosts[hostIndex]!;
          if (left.parentId !== host.id) repel(left, host, 260, 2, alpha);
        }
        for (const rightIndex of spaceGrid(left, leftIndex)) {
          const right = spaces[rightIndex];
          if (right) repel(left, right, 150, 1.8, alpha);
        }
      }

      for (const [parentId, children] of childrenByParent) {
        const parent = state.nodes.get(parentId);
        if (!parent) continue;
        const childGrid = neighbours(
          children,
          children[0]?.kind === "space" ? 120 : 58,
        );
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          if (!child) continue;
          if (!child.pinned) {
            spring(
              child,
              parent,
              child.kind === "space" ? 180 : 105,
              0.028,
              alpha,
            );
          }
          for (const otherIndex of childGrid(child, index)) {
            const other = children[otherIndex];
            if (other) {
              repel(
                child,
                other,
                child.kind === "space" ? 120 : 58,
                1.5,
                alpha,
              );
            }
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
          node.vx = (node.vx / speed) * 14;
          node.vy = (node.vy / speed) * 14;
        }
        node.x += node.vx;
        node.y += node.vy;
        energy += Math.abs(node.vx) + Math.abs(node.vy);
      }
      return energy;
    },
  };
}
