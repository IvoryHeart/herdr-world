import type { FloatingTerminalGeometry } from "./floatingTerminalGeometry";

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
  /** Existing floating geometry is a size/left preference for Grid overflow. */
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
const DEFAULT_FLOATING_WIDTH = 760;
const DEFAULT_FLOATING_HEIGHT = 520;

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
  const width = (stage.width - GAP * (windows.length - 1)) / windows.length;
  if (windows.some((window) => width < window.minWidth)) {
    return unavailable("Stage width is too small for these columns.");
  }
  if (windows.some((window) => stage.height < window.minHeight)) {
    return unavailable("Stage height is too small for these columns.");
  }
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
  const height = (stage.height - GAP * (windows.length - 1)) / windows.length;
  if (windows.some((window) => height < window.minHeight)) {
    return unavailable("Stage height is too small for these rows.");
  }
  if (windows.some((window) => stage.width < window.minWidth)) {
    return unavailable("Stage width is too small for these rows.");
  }
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
  const width = stage.width - CASCADE_X_STEP * (windows.length - 1);
  const height = stage.height - yStep * (windows.length - 1);
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

  const width = (stage.width - GAP) / 2;
  const height = (stage.height - GAP) / 2;
  const firstFour = windows.slice(0, 4);
  if (firstFour.some((window) => width < window.minWidth)) {
    return unavailable("Stage width is too small for this grid.");
  }
  if (
    (windows.length === 3 &&
      (stage.height < windows[0]!.minHeight ||
        height < windows[1]!.minHeight ||
        height < windows[2]!.minHeight)) ||
    (windows.length >= 4 &&
      firstFour.some((window) => height < window.minHeight))
  ) {
    return unavailable("Stage height is too small for this grid.");
  }

  const right = stage.left + width + GAP;
  const bottom = stage.top + height + GAP;
  const tiles =
    windows.length === 3
      ? [
          rect(stage.left, stage.top, width, stage.height),
          rect(right, stage.top, width, height),
          rect(right, bottom, width, height),
        ]
      : [
          rect(stage.left, stage.top, width, height),
          rect(right, stage.top, width, height),
          rect(stage.left, bottom, width, height),
          rect(right, bottom, width, height),
        ];
  const placements = firstFour.map((window, index) => ({
    id: window.id,
    geometry: tiles[index]!,
  }));
  if (windows.length <= 4) return available(placements);

  // Keep both tiled title rows clear. Overflow windows occupy the content bands
  // below those titles, each shifted enough to expose the older floating title.
  const titleStep = Math.max(
    DEFAULT_TITLE_HEIGHT + GAP,
    ...windows.map(
      (window) => (window.titleHeight ?? DEFAULT_TITLE_HEIGHT) + GAP,
    ),
  );
  const shelves = [
    { top: stage.top + titleStep, bottom: bottom - GAP },
    { top: bottom + titleStep, bottom: stage.top + stage.height },
  ];
  const floating = windows.slice(4);
  if (floating.some((window) => stage.width < window.minWidth)) {
    return unavailable("Stage width is too small for a floating grid window.");
  }
  const assignment = assignGridShelves(floating, shelves, titleStep);
  if (!assignment) {
    return unavailable(
      "The stage cannot keep every floating grid window header reachable.",
    );
  }
  const shelfCounts = [0, 0];
  for (const [index, window] of floating.entries()) {
    const shelfIndex = assignment[index]!;
    const shelf = shelves[shelfIndex]!;
    const nextTop = shelf.top + titleStep * shelfCounts[shelfIndex]!;
    shelfCounts[shelfIndex]! += 1;
    const prior = validStage(window.geometry) ? window.geometry : null;
    const floatingWidth = clamp(
      prior?.width ?? DEFAULT_FLOATING_WIDTH,
      window.minWidth,
      stage.width,
    );
    const floatingHeight = clamp(
      prior?.height ?? DEFAULT_FLOATING_HEIGHT,
      window.minHeight,
      shelf.bottom - nextTop,
    );
    placements.push({
      id: window.id,
      geometry: rect(
        clamp(
          prior?.left ?? stage.left + (stage.width - floatingWidth) / 2,
          stage.left,
          stage.left + stage.width - floatingWidth,
        ),
        nextTop,
        floatingWidth,
        floatingHeight,
      ),
    });
  }
  return available(placements);
}

function assignGridShelves(
  windows: readonly TerminalWindowArrangementWindow[],
  shelves: readonly { top: number; bottom: number }[],
  step: number,
): number[] | null {
  const memo = new Map<string, boolean>();
  const fits = (shelfIndex: number, used: number, minHeight: number) => {
    const shelf = shelves[shelfIndex]!;
    return shelf.top + step * used + minHeight <= shelf.bottom;
  };
  const canPlace = (index: number, upperCount: number): boolean => {
    if (index === windows.length) return true;
    const key = `${index}:${upperCount}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const window = windows[index]!;
    const possible =
      (fits(0, upperCount, window.minHeight) &&
        canPlace(index + 1, upperCount + 1)) ||
      (fits(1, index - upperCount, window.minHeight) &&
        canPlace(index + 1, upperCount));
    memo.set(key, possible);
    return possible;
  };
  if (!canPlace(0, 0)) return null;

  const assignment: number[] = [];
  let upperCount = 0;
  for (const [index, window] of windows.entries()) {
    const useUpper =
      fits(0, upperCount, window.minHeight) &&
      canPlace(index + 1, upperCount + 1);
    assignment.push(useUpper ? 0 : 1);
    if (useUpper) upperCount += 1;
  }
  return assignment;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unavailable(reason: string): TerminalWindowArrangementResult {
  return { available: false, reason };
}

function available(
  placements: TerminalWindowArrangementPlacement[],
): TerminalWindowArrangementResult {
  return { available: true, placements };
}
