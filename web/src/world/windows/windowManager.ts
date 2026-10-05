import {
  resolveTerminalWindowArrangement,
  type TerminalWindowArrangementPreset,
} from "../terminalWindowArrangement";
import type { FloatingTerminalGeometry as Rect } from "../floatingTerminalGeometry";

export type Size = { width: number; height: number };
export type SnapTarget =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type WindowInput = {
  id: string;
  label: string;
  initialGeometry?: Rect;
  initialSnap?: SnapTarget;
};
type Placement =
  | { kind: "floating"; rect: Rect; canvas?: Size }
  | { kind: "snap"; target: SnapTarget }
  | { kind: "tile"; rect: Rect }
  | { kind: "cascade"; rect: Rect };
export type ManagedWindow = {
  id: string;
  placement: Placement;
  floating: Rect;
  minimized: boolean;
  dismissed: boolean;
  maximized: boolean;
};
type Layout = {
  preset: TerminalWindowArrangementPreset;
  size: Size;
  minimum: Size;
};
export type WindowManagerState = {
  windows: Record<string, ManagedWindow>;
  order: string[];
  stack: string[];
  activeId: string | null;
  focusMode: boolean;
  revealVersion: number;
  layout: Layout | null;
  baseline: {
    windows: Record<string, ManagedWindow>;
    focusMode: boolean;
    layout: Layout | null;
  } | null;
};
export type WindowDivider = {
  axis: "x" | "y";
  before: string[];
  after: string[];
  position: number;
  start: number;
  length: number;
};
export type WindowCommand =
  | {
      type: "focus" | "raise" | "minimize" | "dismiss" | "maximize" | "float";
      id: string;
    }
  | { type: "place"; id: string; rect: Rect }
  | { type: "snap"; id: string; target: SnapTarget }
  | {
      type: "arrange";
      preset: TerminalWindowArrangementPreset;
      includeMinimized?: boolean;
    }
  | { type: "restore-layout" }
  | { type: "dismiss-all" }
  | { type: "divide"; divider: WindowDivider; delta: number };

const GAP = 8;
export const WINDOW_MINIMUM = { width: 220, height: 160 };
export const createWindowManager = (): WindowManagerState => ({
  windows: {},
  order: [],
  stack: [],
  activeId: null,
  focusMode: false,
  revealVersion: 0,
  layout: null,
  baseline: null,
});
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), n));
export function fitWindow(rect: Rect, size: Size): Rect {
  const width = clamp(
    rect.width,
    Math.min(WINDOW_MINIMUM.width, size.width),
    size.width,
  );
  const height = clamp(
    rect.height,
    Math.min(WINDOW_MINIMUM.height, size.height),
    size.height,
  );
  return {
    width,
    height,
    left: clamp(rect.left, 0, size.width - width),
    top: clamp(rect.top, 0, size.height - height),
  };
}
export function initialWindowRect(index: number, size: Size): Rect {
  return fitWindow(
    {
      left: 24 + (index % 8) * 28,
      top: 24 + (index % 8) * 28,
      width: 760,
      height: 520,
    },
    size,
  );
}
export function reconcileWindows(
  state: WindowManagerState,
  inputs: readonly WindowInput[],
  size: Size,
): WindowManagerState {
  if (size.width <= 0 || size.height <= 0) return state;
  const ids = new Set(inputs.map((input) => input.id));
  const windows = Object.fromEntries(
    Object.entries(state.windows).filter(([id]) => ids.has(id)),
  );
  let changed = Object.keys(windows).length !== state.order.length;
  const order = state.order.filter((id) => ids.has(id));
  const stack = state.stack.filter((id) => ids.has(id));
  let activeId = state.activeId;
  for (const input of inputs) {
    if (windows[input.id]) continue;
    const rect = fitWindow(
      input.initialGeometry ?? initialWindowRect(order.length, size),
      size,
    );
    windows[input.id] = {
      id: input.id,
      placement: input.initialSnap
        ? { kind: "snap", target: input.initialSnap }
        : { kind: "floating", rect },
      floating: rect,
      minimized: false,
      dismissed: false,
      maximized: false,
    };
    order.push(input.id);
    stack.push(input.id);
    activeId = input.id;
    changed = true;
  }
  if (!changed) return state;
  if (!order.length)
    return { ...createWindowManager(), revealVersion: state.revealVersion + 1 };
  if (
    !activeId ||
    !windows[activeId] ||
    windows[activeId].dismissed ||
    windows[activeId].minimized
  ) {
    activeId =
      [...stack]
        .reverse()
        .find((id) => !windows[id]!.dismissed && !windows[id]!.minimized) ??
      null;
  }
  return {
    ...state,
    windows,
    order,
    stack,
    activeId,
    revealVersion: state.revealVersion + 1,
    baseline: state.baseline
      ? {
          ...state.baseline,
          windows: Object.fromEntries(
            Object.entries(state.baseline.windows).filter(([id]) =>
              ids.has(id),
            ),
          ),
        }
      : null,
  };
}
export function snapGeometry(target: SnapTarget, size: Size): Rect {
  const halfWidth = Math.max(0, (size.width - GAP) / 2);
  const halfHeight = Math.max(0, (size.height - GAP) / 2);
  const horizontal = target.includes("left") || target.includes("right");
  const vertical = target.includes("top") || target.includes("bottom");
  return {
    left: target.includes("right") ? halfWidth + GAP : 0,
    top: target.includes("bottom") ? halfHeight + GAP : 0,
    width: horizontal ? halfWidth : size.width,
    height: vertical ? halfHeight : size.height,
  };
}
export function usesWindowCanvas(entry: ManagedWindow): boolean {
  return (
    entry.placement.kind === "tile" ||
    entry.placement.kind === "cascade" ||
    (entry.placement.kind === "floating" &&
      entry.placement.canvas !== undefined)
  );
}

export function windowCanvas(state: WindowManagerState, size: Size): Size {
  const arranged = state.order
    .map((id) => state.windows[id]!)
    .filter(
      (entry) =>
        !entry.dismissed &&
        (entry.placement.kind === "tile" || entry.placement.kind === "cascade"),
    );
  const minimum =
    !state.layout || !arranged.length
      ? { width: 0, height: 0 }
      : state.layout.preset === "cascade"
        ? state.layout.minimum
        : arranged.reduce(
            (result, entry) => {
              if (entry.placement.kind !== "tile") return result;
              return {
                width: Math.max(
                  result.width,
                  WINDOW_MINIMUM.width / entry.placement.rect.width,
                ),
                height: Math.max(
                  result.height,
                  WINDOW_MINIMUM.height / entry.placement.rect.height,
                ),
              };
            },
            { width: 0, height: 0 },
          );
  const canvas = {
    width: Math.max(size.width, minimum.width),
    height: Math.max(size.height, minimum.height),
  };
  // A manually resized tile keeps canvas coordinates after becoming floating,
  // including when the last remaining tile is moved or dismissed.
  for (const entry of Object.values(state.windows)) {
    if (
      entry.dismissed ||
      entry.placement.kind !== "floating" ||
      !entry.placement.canvas
    )
      continue;
    const rect = entry.placement.rect;
    canvas.width = Math.max(
      canvas.width,
      entry.placement.canvas.width,
      rect.left + rect.width,
    );
    canvas.height = Math.max(
      canvas.height,
      entry.placement.canvas.height,
      rect.top + rect.height,
    );
  }
  return canvas;
}
export function windowGeometry(
  state: WindowManagerState,
  id: string,
  size: Size,
  compact = false,
): Rect | null {
  const entry = state.windows[id];
  if (!entry) return null;
  if (compact || entry.maximized || state.focusMode)
    return { left: 0, top: 0, ...size };
  if (entry.placement.kind === "snap")
    return snapGeometry(entry.placement.target, size);
  if (entry.placement.kind === "floating" && !entry.placement.canvas)
    return fitWindow(entry.placement.rect, size);
  const canvas = windowCanvas(state, size);
  if (entry.placement.kind === "cascade" || entry.placement.kind === "floating")
    return fitWindow(entry.placement.rect, canvas);
  const rect = entry.placement.rect;
  return {
    left: rect.left * canvas.width,
    top: rect.top * canvas.height,
    width: rect.width * canvas.width,
    height: rect.height * canvas.height,
  };
}
export function visibleWindowIds(
  state: WindowManagerState,
  compact: boolean,
): string[] {
  const visible = state.order.filter(
    (id) => !state.windows[id]!.minimized && !state.windows[id]!.dismissed,
  );
  if (!compact && !state.focusMode) return visible;
  return state.activeId && visible.includes(state.activeId)
    ? [state.activeId]
    : visible.slice(-1);
}
function focus(
  state: WindowManagerState,
  id: string,
  reveal: boolean,
): WindowManagerState {
  const entry = state.windows[id];
  if (!entry || (!reveal && (entry.dismissed || entry.minimized))) return state;
  if (
    !reveal &&
    state.activeId === id &&
    state.stack[state.stack.length - 1] === id &&
    !entry.dismissed &&
    !entry.minimized
  )
    return state;
  return {
    ...state,
    activeId: id,
    revealVersion: state.revealVersion + (reveal ? 1 : 0),
    stack: [...state.stack.filter((candidate) => candidate !== id), id],
    windows: reveal
      ? {
          ...state.windows,
          [id]: { ...entry, minimized: false, dismissed: false },
        }
      : state.windows,
  };
}
function update(
  state: WindowManagerState,
  id: string,
  patch: Partial<ManagedWindow>,
): WindowManagerState {
  const entry = state.windows[id];
  return entry
    ? { ...state, windows: { ...state.windows, [id]: { ...entry, ...patch } } }
    : state;
}
export function reduceWindowManager(
  state: WindowManagerState,
  action: WindowCommand,
  size: Size,
): WindowManagerState {
  if (action.type === "focus" || action.type === "raise")
    return focus(state, action.id, action.type === "focus");
  if (action.type === "restore-layout") {
    if (!state.baseline) return state;
    const windows = { ...state.windows };
    for (const [id, saved] of Object.entries(state.baseline.windows)) {
      const current = windows[id];
      if (current && !current.dismissed)
        windows[id] = {
          ...saved,
          minimized: current.minimized,
          dismissed: false,
          maximized: false,
        };
    }
    return {
      ...state,
      windows,
      focusMode: state.baseline.focusMode,
      layout: state.baseline.layout,
      baseline: null,
    };
  }
  if (action.type === "dismiss-all") {
    return {
      ...state,
      activeId: null,
      windows: Object.fromEntries(
        Object.entries(state.windows).map(([id, w]) => [
          id,
          { ...w, dismissed: true, maximized: false },
        ]),
      ),
    };
  }
  if (action.type === "arrange") {
    const ids = state.order.filter(
      (id) => action.includeMinimized || !state.windows[id]!.minimized,
    );
    if (!ids.length) return state;
    const activeId = ids.includes(state.activeId ?? "")
      ? state.activeId!
      : ids[ids.length - 1]!;
    const result = resolveTerminalWindowArrangement(
      action.preset,
      { left: 0, top: 0, ...size },
      ids.map((id) => ({
        id,
        minWidth: Math.min(420, size.width),
        minHeight: Math.min(280, size.height),
        titleHeight: 40,
      })),
      activeId,
    );
    if (!result.available) {
      if (!action.includeMinimized) return state;
      // Open all is also a visibility action. A single tab or a compact work
      // area may not support Grid, but every requested window must reopen.
      const windows = { ...state.windows };
      for (const id of ids)
        windows[id] = { ...windows[id]!, minimized: false, dismissed: false };
      return focus({ ...state, windows }, activeId, true);
    }
    const windows = { ...state.windows };
    const participants = structuredClone(
      Object.fromEntries(ids.map((id) => [id, windows[id]!])),
    );
    const baseline = state.baseline
      ? {
          ...state.baseline,
          windows: { ...participants, ...state.baseline.windows },
        }
      : {
          windows: participants,
          focusMode: state.focusMode,
          layout: state.layout,
        };
    const canvas = {
      width: Math.max(
        size.width,
        ...result.placements.map((p) => p.geometry.left + p.geometry.width),
      ),
      height: Math.max(
        size.height,
        ...result.placements.map((p) => p.geometry.top + p.geometry.height),
      ),
    };
    let minimum =
      action.preset === "cascade" ? { ...canvas } : { width: 0, height: 0 };
    for (const id of ids)
      windows[id] = {
        ...windows[id]!,
        dismissed: false,
        minimized: false,
        maximized: false,
      };
    if (action.preset !== "single")
      for (const { id, geometry: rect } of result.placements) {
        if (action.preset === "cascade") {
          windows[id] = {
            ...windows[id]!,
            placement: { kind: "cascade", rect },
          };
        } else {
          const relative = {
            left: rect.left / canvas.width,
            top: rect.top / canvas.height,
            width: rect.width / canvas.width,
            height: rect.height / canvas.height,
          };
          minimum = {
            width: Math.max(
              minimum.width,
              WINDOW_MINIMUM.width / relative.width,
            ),
            height: Math.max(
              minimum.height,
              WINDOW_MINIMUM.height / relative.height,
            ),
          };
          windows[id] = {
            ...windows[id]!,
            placement: { kind: "tile", rect: relative },
          };
        }
      }
    return {
      ...state,
      windows,
      baseline,
      activeId,
      revealVersion: state.revealVersion + 1,
      focusMode: action.preset === "single",
      layout:
        action.preset === "single"
          ? state.layout
          : { preset: action.preset, size: canvas, minimum },
    };
  }
  if (action.type === "divide")
    return divide(state, action.divider, action.delta, size);
  const entry = state.windows[action.id];
  if (!entry) return state;
  if (action.type === "minimize" || action.type === "dismiss") {
    const next = update(
      state,
      action.id,
      action.type === "minimize"
        ? { minimized: true }
        : { dismissed: true, maximized: false },
    );
    if (next.activeId === action.id)
      next.activeId =
        [...next.stack]
          .reverse()
          .find(
            (id) =>
              !next.windows[id]!.minimized && !next.windows[id]!.dismissed,
          ) ?? null;
    return next;
  }
  if (action.type === "maximize") {
    const maximized = !(entry.maximized || state.focusMode);
    return focus(
      { ...update(state, action.id, { maximized }), focusMode: false },
      action.id,
      true,
    );
  }
  if (action.type === "snap")
    return focus(
      {
        ...update(state, action.id, {
          placement: { kind: "snap", target: action.target },
          maximized: false,
        }),
        focusMode: false,
      },
      action.id,
      true,
    );
  const movementCanvas = windowCanvas(state, size);
  const canvas =
    action.type === "place" &&
    !state.focusMode &&
    (usesWindowCanvas(entry) ||
      movementCanvas.width > size.width ||
      movementCanvas.height > size.height)
      ? movementCanvas
      : undefined;
  const rect = fitWindow(
    action.type === "place" ? action.rect : entry.floating,
    canvas ?? size,
  );
  return focus(
    {
      ...update(state, action.id, {
        placement: { kind: "floating", rect, ...(canvas ? { canvas } : {}) },
        floating: rect,
        maximized: false,
      }),
      focusMode: false,
    },
    action.id,
    true,
  );
}

export function windowDividers(
  state: WindowManagerState,
  size: Size,
): WindowDivider[] {
  if (
    state.focusMode ||
    !state.layout ||
    state.layout.preset === "cascade" ||
    visibleWindowIds(state, false).some((id) => state.windows[id]!.maximized)
  )
    return [];
  const ids = visibleWindowIds(state, false).filter(
    (id) =>
      state.windows[id]!.placement.kind === "tile" &&
      !state.windows[id]!.maximized,
  );
  const dividers: WindowDivider[] = [];
  for (const axis of ["x", "y"] as const) {
    const dimension = axis === "x" ? "width" : "height";
    const gap =
      (GAP * windowCanvas(state, size)[dimension]) /
      state.layout.size[dimension];
    for (const beforeId of ids) {
      const a = windowGeometry(state, beforeId, size)!;
      const end = axis === "x" ? a.left + a.width : a.top + a.height;
      const matches = ids.filter((id) => {
        if (id === beforeId) return false;
        const b = windowGeometry(state, id, size)!;
        const begin = axis === "x" ? b.left : b.top;
        return (
          Math.abs(begin - end - gap) < 2 &&
          (axis === "x"
            ? Math.min(a.top + a.height, b.top + b.height) >
              Math.max(a.top, b.top)
            : Math.min(a.left + a.width, b.left + b.width) >
              Math.max(a.left, b.left))
        );
      });
      if (!matches.length) continue;
      const existing = dividers.find(
        (d) => d.axis === axis && Math.abs(d.position - end - gap / 2) < 2,
      );
      const start = axis === "x" ? a.top : a.left;
      const length = axis === "x" ? a.height : a.width;
      if (existing) {
        existing.before = [...new Set([...existing.before, beforeId])];
        existing.after = [...new Set([...existing.after, ...matches])];
        const finish = Math.max(
          existing.start + existing.length,
          start + length,
        );
        existing.start = Math.min(existing.start, start);
        existing.length = finish - existing.start;
      } else
        dividers.push({
          axis,
          before: [beforeId],
          after: matches,
          position: end + gap / 2,
          start,
          length,
        });
    }
  }
  return dividers;
}
function divide(
  state: WindowManagerState,
  divider: WindowDivider,
  delta: number,
  size: Size,
): WindowManagerState {
  const dimension = divider.axis === "x" ? "width" : "height";
  const coordinate = divider.axis === "x" ? "left" : "top";
  const canvas = windowCanvas(state, size);
  const before = divider.before.filter(
    (id) => state.windows[id]?.placement.kind === "tile",
  );
  const after = divider.after.filter(
    (id) => state.windows[id]?.placement.kind === "tile",
  );
  if (!before.length || !after.length) return state;
  const minimum = WINDOW_MINIMUM[dimension];
  const low = Math.max(
    ...before.map(
      (id) => minimum - windowGeometry(state, id, size)![dimension],
    ),
  );
  const high = Math.min(
    ...after.map((id) => windowGeometry(state, id, size)![dimension] - minimum),
  );
  const shift = clamp(delta, low, high) / canvas[dimension];
  const windows = { ...state.windows };
  for (const id of [...before, ...after]) {
    const entry = windows[id]!;
    if (entry.placement.kind !== "tile") continue;
    const rect = { ...entry.placement.rect };
    if (before.includes(id)) rect[dimension] += shift;
    else {
      rect[coordinate] += shift;
      rect[dimension] -= shift;
    }
    windows[id] = { ...entry, placement: { kind: "tile", rect } };
  }
  return { ...state, windows };
}
