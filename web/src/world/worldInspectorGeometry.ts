import { type FloatingTerminalGeometry } from "./floatingTerminalGeometry";
import { type TerminalWindowArrangementStage } from "./terminalWindowArrangement";

type DockedInspectorGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const VISUAL_SCROLL_CONTROL_WIDTH = 32;

export function visualGridArrangementStage(
  stage: TerminalWindowArrangementStage,
): TerminalWindowArrangementStage {
  return {
    ...stage,
    width: Math.max(1, stage.width - VISUAL_SCROLL_CONTROL_WIDTH),
  };
}

export function visualInspectorTerminalActive(
  id: string,
  dockedId: string | null,
  dockedSuppressed: boolean,
  arrangedDocked: boolean,
  visibleFloatingIds: ReadonlySet<string>,
): boolean {
  return id === dockedId
    ? !dockedSuppressed && (!arrangedDocked || visibleFloatingIds.has(id))
    : visibleFloatingIds.has(id);
}

export function visualInspectorArrangementStage(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  fixedPositionScale = 1,
): TerminalWindowArrangementStage {
  return {
    left: bounds.left / fixedPositionScale + 8,
    top: bounds.top / fixedPositionScale + 8,
    width: Math.max(0, bounds.width / fixedPositionScale - 16),
    height: Math.max(0, bounds.height / fixedPositionScale - 16),
  };
}

export function fitVisualInspectorArrangementGeometry(
  geometry: FloatingTerminalGeometry,
  stage: TerminalWindowArrangementStage,
): FloatingTerminalGeometry {
  const width = Math.min(geometry.width, stage.width);
  const height = Math.min(geometry.height, stage.height);
  return {
    left: Math.max(
      stage.left,
      Math.min(geometry.left, stage.left + stage.width - width),
    ),
    top: Math.max(
      stage.top,
      Math.min(geometry.top, stage.top + stage.height - Math.min(height, 56)),
    ),
    width,
    height,
  };
}

export function moveDockedInspectorGeometry(
  geometry: DockedInspectorGeometry,
  deltaX: number,
  deltaY: number,
  bounds: { left?: number; top?: number; width: number; height: number },
): DockedInspectorGeometry {
  const minimumLeft = bounds.left ?? 0;
  const minimumTop = bounds.top ?? 0;
  return {
    ...geometry,
    left: Math.max(
      minimumLeft,
      Math.min(
        geometry.left + deltaX,
        Math.max(minimumLeft, minimumLeft + bounds.width - geometry.width),
      ),
    ),
    top: Math.max(
      minimumTop,
      Math.min(
        geometry.top + deltaY,
        Math.max(minimumTop, minimumTop + bounds.height - geometry.height),
      ),
    ),
  };
}

export function shouldRecordVisualInspectorGeometry(
  id: string,
  maximizedInspectorId: string | null,
  compactArrangement: boolean,
) {
  return !compactArrangement && id !== maximizedInspectorId;
}
