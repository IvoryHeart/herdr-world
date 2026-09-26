export type FloatingTerminalPosition = { left: number; top: number };
export type FloatingTerminalSize = { width: number; height: number };
export type FloatingTerminalGeometry = FloatingTerminalPosition &
  FloatingTerminalSize;
export type FloatingTerminalViewport = FloatingTerminalSize & {
  offsetLeft?: number;
  offsetTop?: number;
};

const WINDOW_MARGIN = 8;
export const FLOATING_TERMINAL_DEFAULT_SIZE = {
  width: 760,
  height: 520,
} as const;
export const FLOATING_TERMINAL_MIN_SIZE = { width: 420, height: 280 } as const;
export const SPACES_TAB_WINDOW_MIN_SIZE = { width: 320, height: 180 } as const;
export const TILED_TERMINAL_MIN_SIZE = { width: 220, height: 160 } as const;
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
  const width = Math.min(
    FLOATING_TERMINAL_DEFAULT_SIZE.width,
    Math.max(0, viewport.width - WINDOW_MARGIN * 2),
  );
  const height = Math.min(
    FLOATING_TERMINAL_DEFAULT_SIZE.height,
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
  const width = clamp(
    geometry.width,
    Math.min(FLOATING_TERMINAL_MIN_SIZE.width, maxWidth),
    maxWidth,
  );
  const height = clamp(
    geometry.height,
    Math.min(FLOATING_TERMINAL_MIN_SIZE.height, maxHeight),
    maxHeight,
  );
  return {
    ...clampFloatingTerminalPosition(geometry, viewport, { width, height }),
    width,
    height,
  };
}

/** A tile may retain its compact minimum when it is resized by the user. */
export function resizeMinimumForGeometry(
  geometry: FloatingTerminalSize,
  normalMinimum: FloatingTerminalSize,
): FloatingTerminalSize {
  return {
    width:
      geometry.width < normalMinimum.width
        ? Math.min(normalMinimum.width, TILED_TERMINAL_MIN_SIZE.width)
        : normalMinimum.width,
    height:
      geometry.height < normalMinimum.height
        ? Math.min(normalMinimum.height, TILED_TERMINAL_MIN_SIZE.height)
        : normalMinimum.height,
  };
}

export function resizeFloatingTerminalGeometry(
  geometry: FloatingTerminalGeometry,
  deltaWidth: number,
  deltaHeight: number,
  viewport: FloatingTerminalSize,
  minimum: FloatingTerminalSize = FLOATING_TERMINAL_MIN_SIZE,
): FloatingTerminalGeometry {
  const maxWidth = Math.max(0, viewport.width - WINDOW_MARGIN - geometry.left);
  const maxHeight = Math.max(0, viewport.height - WINDOW_MARGIN - geometry.top);
  return {
    left: geometry.left,
    top: geometry.top,
    width: clamp(
      geometry.width + deltaWidth,
      Math.min(minimum.width, maxWidth),
      maxWidth,
    ),
    height: clamp(
      geometry.height + deltaHeight,
      Math.min(minimum.height, maxHeight),
      maxHeight,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
