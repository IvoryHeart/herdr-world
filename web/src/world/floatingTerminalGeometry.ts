export type FloatingTerminalPosition = { left: number; top: number };
export type FloatingTerminalSize = { width: number; height: number };
export type FloatingTerminalGeometry = FloatingTerminalPosition &
  FloatingTerminalSize;
export type FloatingTerminalViewport = FloatingTerminalSize & {
  offsetLeft?: number;
  offsetTop?: number;
};

const WINDOW_MARGIN = 8;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 280;
const COMPACT_VIEWPORT_MAX_WIDTH = 720;
const MIN_VISIBLE_DESKTOP_TITLE_HEIGHT = 56;

export function floatingTerminalContainingViewport(
  viewport: FloatingTerminalViewport,
  renderedOrigin: FloatingTerminalPosition,
): FloatingTerminalSize {
  return {
    width: Math.max(
      0,
      (viewport.offsetLeft ?? 0) + viewport.width - renderedOrigin.left,
    ),
    height: Math.max(
      0,
      (viewport.offsetTop ?? 0) + viewport.height - renderedOrigin.top,
    ),
  };
}

export function defaultFloatingTerminalGeometry(
  cascadeIndex: number,
  viewport: FloatingTerminalSize,
): FloatingTerminalGeometry {
  const width = Math.min(760, Math.max(0, viewport.width - WINDOW_MARGIN * 2));
  const height = Math.min(
    520,
    Math.max(0, viewport.height - WINDOW_MARGIN * 2),
  );
  return clampFloatingTerminalGeometry(
    {
      left: 24 + Math.max(0, cascadeIndex) * 32,
      top: viewport.height - 24 - height - Math.max(0, cascadeIndex) * 24,
      width,
      height,
    },
    viewport,
  );
}

export function clampFloatingTerminalPosition(
  position: FloatingTerminalPosition,
  viewport: FloatingTerminalSize,
  windowSize: FloatingTerminalSize,
): FloatingTerminalPosition {
  const maxLeft = Math.max(
    WINDOW_MARGIN,
    viewport.width - WINDOW_MARGIN - windowSize.width,
  );
  const containedHeight =
    viewport.width <= COMPACT_VIEWPORT_MAX_WIDTH
      ? windowSize.height
      : Math.min(windowSize.height, MIN_VISIBLE_DESKTOP_TITLE_HEIGHT);
  const maxTop = Math.max(
    WINDOW_MARGIN,
    viewport.height - WINDOW_MARGIN - containedHeight,
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
