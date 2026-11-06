/** Where a spatial view shows a node, for the line from its Inspector window. */
export type WorldCanvasAnchor = {
  x: number;
  y: number;
  visible: boolean;
  edge: "top" | "right" | "bottom" | "left" | null;
};

export type WorldCanvasAnchors = {
  agent: WorldCanvasAnchor | null;
  workbench: WorldCanvasAnchor | null;
};

export type WorldConversationAnchorTarget = {
  id: string;
  selectedKey: string | null;
  targetKey: string;
};

export type WorldConversationAnchors = Record<string, WorldCanvasAnchors>;

/** A hovered node and where the pointer is, for a callout. */
export type WorldCanvasHover = {
  key: string;
  clientX: number;
  clientY: number;
};

export type WorldConnectorTargetBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Whether two anchor sets would draw the same lines. */
export function sameCanvasAnchors(
  a: Readonly<Record<string, WorldCanvasAnchor>> | null,
  b: Readonly<Record<string, WorldCanvasAnchor>> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key];
    const right = b[key];
    return (
      !!left &&
      !!right &&
      left.x === right.x &&
      left.y === right.y &&
      left.visible === right.visible &&
      left.edge === right.edge
    );
  });
}

export function preferredOfficeConnectorAnchor(
  anchors: WorldCanvasAnchors,
): WorldCanvasAnchor | null {
  return anchors.agent ?? anchors.workbench ?? null;
}

export function worldConnectorTargetPoint(bounds: WorldConnectorTargetBounds) {
  return {
    x: bounds.right,
    y: (bounds.top + bounds.bottom) / 2,
  };
}

export function worldConnectorPath(
  source: Pick<WorldCanvasAnchor, "x" | "y">,
  target: { x: number; y: number },
) {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const distance = Math.max(48, Math.min(180, Math.abs(deltaX) * 0.45));
    const direction = Math.sign(deltaX) || 1;
    return `M ${source.x} ${source.y} C ${source.x + direction * distance} ${source.y}, ${target.x - direction * distance} ${target.y}, ${target.x} ${target.y}`;
  }
  const distance = Math.max(48, Math.min(180, Math.abs(deltaY) * 0.45));
  const direction = Math.sign(deltaY) || 1;
  return `M ${source.x} ${source.y} C ${source.x} ${source.y + direction * distance}, ${target.x} ${target.y - direction * distance}, ${target.x} ${target.y}`;
}
