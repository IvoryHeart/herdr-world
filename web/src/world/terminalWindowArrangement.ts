import {
  FLOATING_TERMINAL_DEFAULT_SIZE,
  TILED_TERMINAL_MIN_SIZE,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";

export type TerminalWindowArrangementPreset =
  | "single"
  | "cascade"
  | "columns"
  | "rows"
  | "grid";

export type TerminalWindowArrangementStage = FloatingTerminalGeometry;

/** Windows are ordered from back to front, so the last item has the highest z-order. */
export type TerminalWindowArrangementWindow = {
  id: string;
  minWidth: number;
  minHeight: number;
  geometry?: FloatingTerminalGeometry;
  /** Reachable title and window controls; defaults to 40 CSS pixels. */
  titleHeight?: number;
};

export type TerminalWindowArrangementPlacement = {
  id: string;
  geometry: FloatingTerminalGeometry;
};

export type TerminalWindowArrangementResult =
  | { available: true; placements: TerminalWindowArrangementPlacement[] }
  | { available: false; reason: string };

const GAP = 8;
const CASCADE_X_STEP = 32;
const DEFAULT_TITLE_HEIGHT = 40;

export function terminalGridContentHeight(
  placements: readonly TerminalWindowArrangementPlacement[],
  viewportHeight: number,
  stageTop = 0,
): number {
  return Math.max(
    viewportHeight,
    placements.reduce(
      (bottom, { geometry }) =>
        Math.max(bottom, geometry.top + geometry.height - stageTop),
      0,
    ),
  );
}

export function terminalArrangementContentWidth(
  placements: readonly TerminalWindowArrangementPlacement[],
  viewportWidth: number,
  stageLeft = 0,
): number {
  return Math.max(
    viewportWidth,
    placements.reduce(
      (right, { geometry }) =>
        Math.max(right, geometry.left + geometry.width - stageLeft),
      0,
    ),
  );
}

export function terminalArrangementWindowVisible(
  geometry: FloatingTerminalGeometry,
  scrollLeft: number,
  scrollTop: number,
  viewportWidth: number,
  viewportHeight: number,
  stageLeft = 0,
  stageTop = 0,
): boolean {
  const left = geometry.left - stageLeft;
  return (
    left + geometry.width >= scrollLeft - viewportWidth &&
    left <= scrollLeft + viewportWidth * 2 &&
    terminalGridWindowVisible(geometry, scrollTop, viewportHeight, stageTop)
  );
}

export function terminalArrangementScrollLeftForWindow(
  geometry: FloatingTerminalGeometry,
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  stageLeft = 0,
): number {
  const left = geometry.left - stageLeft;
  const next =
    left < scrollLeft
      ? left
      : left + geometry.width > scrollLeft + viewportWidth
        ? left + geometry.width - viewportWidth
        : scrollLeft;
  return Math.max(0, Math.min(contentWidth - viewportWidth, next));
}

export function terminalGridWindowVisible(
  geometry: FloatingTerminalGeometry,
  scrollTop: number,
  viewportHeight: number,
  stageTop = 0,
): boolean {
  const overscan = viewportHeight;
  const top = geometry.top - stageTop;
  return (
    top + geometry.height >= scrollTop - overscan &&
    top <= scrollTop + viewportHeight + overscan
  );
}

export function terminalGridScrollTopForWindow(
  geometry: FloatingTerminalGeometry,
  scrollTop: number,
  viewportHeight: number,
  contentHeight: number,
  stageTop = 0,
): number {
  const top = geometry.top - stageTop;
  const next =
    top < scrollTop
      ? top
      : top + geometry.height > scrollTop + viewportHeight
        ? top + geometry.height - viewportHeight
        : scrollTop;
  return Math.max(0, Math.min(contentHeight - viewportHeight, next));
}

/** Purely resolves browser presentation geometry; Restore belongs to the window registry. */
export function resolveTerminalWindowArrangement(
  preset: TerminalWindowArrangementPreset,
  stage: TerminalWindowArrangementStage,
  windows: readonly TerminalWindowArrangementWindow[],
  activeId: string | null,
): TerminalWindowArrangementResult {
  if (!validStage(stage)) {
    return unavailable("The available stage has no usable size.");
  }
  if (windows.length === 0) {
    return unavailable("No eligible terminal windows are open.");
  }
  if (!validWindows(windows)) {
    return unavailable("Window dimensions or identities are unavailable.");
  }

  if (preset === "single") {
    const active = windows.find((window) => window.id === activeId);
    if (!active) return unavailable("Active window is unavailable.");
    if (stage.width < active.minWidth || stage.height < active.minHeight) {
      return unavailable("The stage is too small for the active window.");
    }
    return available([{ id: active.id, geometry: { ...stage } }]);
  }

  if (windows.length < 2) {
    return unavailable("Open another eligible window to use this arrangement.");
  }

  switch (preset) {
    case "columns":
      return columns(stage, windows);
    case "rows":
      return rows(stage, windows);
    case "grid":
      return grid(stage, windows);
    case "cascade":
      return cascade(stage, windows);
  }
}

/** Suitable for disabled menu choices; null means the preset is currently usable. */
export function terminalWindowArrangementReason(
  preset: TerminalWindowArrangementPreset,
  stage: TerminalWindowArrangementStage,
  windows: readonly TerminalWindowArrangementWindow[],
  activeId: string | null,
): string | null {
  const result = resolveTerminalWindowArrangement(
    preset,
    stage,
    windows,
    activeId,
  );
  return result.available ? null : result.reason;
}

function columns(
  stage: TerminalWindowArrangementStage,
  windows: readonly TerminalWindowArrangementWindow[],
): TerminalWindowArrangementResult {
  const minimumWidth = windows.reduce(
    (minimum, window) =>
      Math.max(
        minimum,
        Math.min(window.minWidth, TILED_TERMINAL_MIN_SIZE.width),
      ),
    0,
  );
  if (stage.width < minimumWidth) {
    return unavailable("Stage width is too small for these columns.");
  }
  if (windows.some((window) => stage.height < window.minHeight)) {
    return unavailable("Stage height is too small for these columns.");
  }
  const width = Math.max(
    minimumWidth,
    (stage.width - GAP * (windows.length - 1)) / windows.length,
  );
  return available(
    windows.map((window, index) => ({
      id: window.id,
      geometry: {
        left: stage.left + index * (width + GAP),
        top: stage.top,
        width,
        height: stage.height,
      },
    })),
  );
}

function rows(
  stage: TerminalWindowArrangementStage,
  windows: readonly TerminalWindowArrangementWindow[],
): TerminalWindowArrangementResult {
  const minimumHeight = windows.reduce(
    (minimum, window) =>
      Math.max(
        minimum,
        Math.min(window.minHeight, TILED_TERMINAL_MIN_SIZE.height),
      ),
    0,
  );
  if (stage.height < minimumHeight) {
    return unavailable("Stage height is too small for these rows.");
  }
  if (windows.some((window) => stage.width < window.minWidth)) {
    return unavailable("Stage width is too small for these rows.");
  }
  const height = Math.max(
    minimumHeight,
    (stage.height - GAP * (windows.length - 1)) / windows.length,
  );
  return available(
    windows.map((window, index) => ({
      id: window.id,
      geometry: {
        left: stage.left,
        top: stage.top + index * (height + GAP),
        width: stage.width,
        height,
      },
    })),
  );
}

function cascade(
  stage: TerminalWindowArrangementStage,
  windows: readonly TerminalWindowArrangementWindow[],
): TerminalWindowArrangementResult {
  const yStep = Math.max(
    DEFAULT_TITLE_HEIGHT + GAP,
    ...windows.map(
      (window) => (window.titleHeight ?? DEFAULT_TITLE_HEIGHT) + GAP,
    ),
  );
  const width = Math.min(
    FLOATING_TERMINAL_DEFAULT_SIZE.width,
    stage.width - CASCADE_X_STEP * (windows.length - 1),
  );
  const height = Math.min(
    FLOATING_TERMINAL_DEFAULT_SIZE.height,
    stage.height - yStep * (windows.length - 1),
  );
  if (windows.some((window) => width < window.minWidth)) {
    return unavailable("Stage width is too small for this cascade.");
  }
  if (windows.some((window) => height < window.minHeight)) {
    return unavailable("Stage height is too small for this cascade.");
  }
  return available(
    windows.map((window, index) => ({
      id: window.id,
      geometry: {
        left: stage.left + index * CASCADE_X_STEP,
        top: stage.top + index * yStep,
        width,
        height,
      },
    })),
  );
}

function grid(
  stage: TerminalWindowArrangementStage,
  windows: readonly TerminalWindowArrangementWindow[],
): TerminalWindowArrangementResult {
  if (windows.length === 2) return columns(stage, windows);
  if (windows.length === 3) {
    const width = (stage.width - GAP) / 2;
    const height = (stage.height - GAP) / 2;
    if (windows.some((window) => width < window.minWidth)) {
      return unavailable("Stage width is too small for this grid.");
    }
    if (
      stage.height < windows[0]!.minHeight ||
      height < windows[1]!.minHeight ||
      height < windows[2]!.minHeight
    ) {
      return unavailable("Stage height is too small for this grid.");
    }
    return available([
      {
        id: windows[0]!.id,
        geometry: rect(stage.left, stage.top, width, stage.height),
      },
      {
        id: windows[1]!.id,
        geometry: rect(stage.left + width + GAP, stage.top, width, height),
      },
      {
        id: windows[2]!.id,
        geometry: rect(
          stage.left + width + GAP,
          stage.top + height + GAP,
          width,
          height,
        ),
      },
    ]);
  }
  const minimumWidth = windows.reduce(
    (minimum, window) =>
      Math.max(
        minimum,
        Math.min(window.minWidth, TILED_TERMINAL_MIN_SIZE.width),
      ),
    0,
  );
  const minimumHeight = windows.reduce(
    (minimum, window) =>
      Math.max(
        minimum,
        Math.min(window.minHeight, TILED_TERMINAL_MIN_SIZE.height),
      ),
    0,
  );
  const maximumColumns = Math.floor((stage.width + GAP) / (minimumWidth + GAP));
  if (maximumColumns < 1) {
    return unavailable("Stage width is too small for this grid.");
  }
  const columnCount = Math.min(
    Math.ceil(Math.sqrt(windows.length)),
    maximumColumns,
  );
  const rowCount = Math.ceil(windows.length / columnCount);
  const width = (stage.width - GAP * (columnCount - 1)) / columnCount;
  const height = Math.max(
    minimumHeight,
    (stage.height - GAP * (rowCount - 1)) / rowCount,
  );
  return available(
    windows.map((window, index) => ({
      id: window.id,
      geometry: rect(
        stage.left + (index % columnCount) * (width + GAP),
        stage.top + Math.floor(index / columnCount) * (height + GAP),
        width,
        height,
      ),
    })),
  );
}

function validStage(
  stage: TerminalWindowArrangementStage | undefined,
): boolean {
  return (
    !!stage &&
    Number.isFinite(stage.left) &&
    Number.isFinite(stage.top) &&
    Number.isFinite(stage.width) &&
    stage.width > 0 &&
    Number.isFinite(stage.height) &&
    stage.height > 0
  );
}

function validWindows(
  windows: readonly TerminalWindowArrangementWindow[],
): boolean {
  const ids = new Set<string>();
  for (const window of windows) {
    if (
      !window.id ||
      ids.has(window.id) ||
      !Number.isFinite(window.minWidth) ||
      window.minWidth <= 0 ||
      !Number.isFinite(window.minHeight) ||
      window.minHeight <= 0 ||
      (window.titleHeight !== undefined &&
        (!Number.isFinite(window.titleHeight) || window.titleHeight <= 0))
    ) {
      return false;
    }
    ids.add(window.id);
  }
  return true;
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): FloatingTerminalGeometry {
  return { left, top, width, height };
}

function unavailable(reason: string): TerminalWindowArrangementResult {
  return { available: false, reason };
}

function available(
  placements: TerminalWindowArrangementPlacement[],
): TerminalWindowArrangementResult {
  return { available: true, placements };
}
