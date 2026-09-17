export type FloatingTerminalPosition = { left: number; top: number };
export type FloatingTerminalSize = { width: number; height: number };
export type FloatingTerminalGeometry = FloatingTerminalPosition &
  FloatingTerminalSize;

const WINDOW_MARGIN = 8;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 280;

export function clampFloatingTerminalPosition(
  position: FloatingTerminalPosition,
  viewport: FloatingTerminalSize,
  windowSize: FloatingTerminalSize,
): FloatingTerminalPosition {
  const maxLeft = Math.max(
    WINDOW_MARGIN,
    viewport.width - WINDOW_MARGIN - windowSize.width,
  );
  const maxTop = Math.max(
    WINDOW_MARGIN,
    viewport.height - WINDOW_MARGIN - windowSize.height,
  );
  return {
    left: clamp(position.left, WINDOW_MARGIN, maxLeft),
    top: clamp(position.top, WINDOW_MARGIN, maxTop),
  };
}

export function moveFloatingTerminalPosition(
  position: FloatingTerminalPosition,
  deltaX: number,
  deltaY: number,
  viewport: FloatingTerminalSize,
  windowSize: FloatingTerminalSize,
): FloatingTerminalPosition {
  return clampFloatingTerminalPosition(
    { left: position.left + deltaX, top: position.top + deltaY },
    viewport,
    windowSize,
  );
}

export function clampFloatingTerminalGeometry(
  geometry: FloatingTerminalGeometry,
  viewport: FloatingTerminalSize,
): FloatingTerminalGeometry {
  const maxWidth = Math.max(0, viewport.width - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(0, viewport.height - WINDOW_MARGIN * 2);
  const width = clamp(geometry.width, Math.min(MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(
    geometry.height,
    Math.min(MIN_HEIGHT, maxHeight),
    maxHeight,
  );
  return {
    ...clampFloatingTerminalPosition(geometry, viewport, { width, height }),
    width,
    height,
  };
}

export function resizeFloatingTerminalGeometry(
  geometry: FloatingTerminalGeometry,
  deltaWidth: number,
  deltaHeight: number,
  viewport: FloatingTerminalSize,
): FloatingTerminalGeometry {
  const maxWidth = Math.max(0, viewport.width - WINDOW_MARGIN - geometry.left);
  const maxHeight = Math.max(0, viewport.height - WINDOW_MARGIN - geometry.top);
  return {
    left: geometry.left,
    top: geometry.top,
    width: clamp(
      geometry.width + deltaWidth,
      Math.min(MIN_WIDTH, maxWidth),
      maxWidth,
    ),
    height: clamp(
      geometry.height + deltaHeight,
      Math.min(MIN_HEIGHT, maxHeight),
      maxHeight,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
