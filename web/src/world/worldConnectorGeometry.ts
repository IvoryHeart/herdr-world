import type {
  OfficeCanvasAnchor,
  OfficeCanvasAnchors,
} from "./PixelOfficeCanvas";

export type WorldConnectorTargetBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function preferredOfficeConnectorAnchor(
  anchors: OfficeCanvasAnchors,
): OfficeCanvasAnchor | null {
  return anchors.agent ?? anchors.workbench ?? null;
}

export function worldConnectorTargetPoint(bounds: WorldConnectorTargetBounds) {
  return {
    x: bounds.right,
    y: (bounds.top + bounds.bottom) / 2,
  };
}

export function worldConnectorPath(
  source: Pick<OfficeCanvasAnchor, "x" | "y">,
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
