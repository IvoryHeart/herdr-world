import {
  clampFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
  type FloatingTerminalSize,
} from "./floatingTerminalGeometry";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";
import type { SnapTarget } from "./windows/windowManager";

export const FLOATING_TERMINAL_GEOMETRY_KEY =
  "worldFloatingTerminalGeometry:v1";
const MAX_SAVED_GEOMETRIES = 64;

type GeometryStorage = Pick<Storage, "getItem" | "setItem">;
type SavedGeometry = { id: string; geometry: FloatingTerminalGeometry };

export function floatingTerminalGeometryId(
  inspector: Pick<WorldInspectorConversation, "connectionId"> & {
    workspaceId?: string;
    tabId?: string;
    nodeId?: string;
    terminalId?: string;
  },
) {
  if (inspector.workspaceId && inspector.tabId) {
    return JSON.stringify([
      inspector.connectionId,
      inspector.workspaceId,
      inspector.tabId,
    ]);
  }
  return JSON.stringify([
    inspector.connectionId,
    inspector.nodeId ?? inspector.terminalId,
  ]);
}

export function readFloatingTerminalGeometry(
  storage: GeometryStorage,
  id: string,
  fallback: FloatingTerminalGeometry,
  viewport: FloatingTerminalSize,
  legacyId?: string,
  fit = clampFloatingTerminalGeometry,
) {
  try {
    const saved = parseSaved(storage.getItem(FLOATING_TERMINAL_GEOMETRY_KEY));
    const stable = saved.find((entry) => entry.id === id)?.geometry;
    const legacy = legacyId
      ? saved.find((entry) => entry.id === legacyId)?.geometry
      : undefined;
    if (!stable && legacy) {
      writeFloatingTerminalGeometry(storage, id, legacy);
    }
    const geometry = stable ?? legacy;
    return fit(geometry ?? fallback, viewport);
  } catch {
    return fit(fallback, viewport);
  }
}

export function writeFloatingTerminalGeometry(
  storage: GeometryStorage,
  id: string,
  geometry: FloatingTerminalGeometry,
) {
  try {
    const retained = parseSaved(
      storage.getItem(FLOATING_TERMINAL_GEOMETRY_KEY),
    ).filter((entry) => entry.id !== id);
    storage.setItem(
      FLOATING_TERMINAL_GEOMETRY_KEY,
      JSON.stringify(
        [...retained, { id, geometry }].slice(-MAX_SAVED_GEOMETRIES),
      ),
    );
  } catch {
    // A presentation preference must never prevent terminal use.
  }
}

function parseSaved(raw: string | null): SavedGeometry[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const { id, geometry } = candidate as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0 || id.length > 1_024) {
      return [];
    }
    if (!validGeometry(geometry)) return [];
    return [{ id, geometry }];
  });
}

function validGeometry(value: unknown): value is FloatingTerminalGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as Record<string, unknown>;
  return ["left", "top", "width", "height"].every(
    (key) =>
      typeof geometry[key] === "number" &&
      Number.isFinite(geometry[key]) &&
      Math.abs(geometry[key]) <= 1_000_000,
  );
}

/** Whether a window was left snapped (and where) or floating. */
export type FloatingTerminalDock = SnapTarget | "float";

export const FLOATING_TERMINAL_DOCK_KEY = "worldFloatingTerminalDock:v1";
const DOCKS = new Set<string>([
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "float",
]);

/** The dock a window was left with, or null when it was never docked or floated. */
export function readFloatingTerminalDock(
  storage: Pick<Storage, "getItem">,
  id: string,
): FloatingTerminalDock | null {
  try {
    const saved = parseDocks(storage.getItem(FLOATING_TERMINAL_DOCK_KEY));
    return saved.find((entry) => entry.id === id)?.dock ?? null;
  } catch {
    return null;
  }
}

/** The width a left or right dock was resized to, or null for half. */
export function readFloatingTerminalDockWidth(
  storage: Pick<Storage, "getItem">,
  id: string,
): number | null {
  try {
    const saved = parseDocks(storage.getItem(FLOATING_TERMINAL_DOCK_KEY));
    return saved.find((entry) => entry.id === id)?.width ?? null;
  } catch {
    return null;
  }
}

export function writeFloatingTerminalDock(
  storage: GeometryStorage,
  id: string,
  dock: FloatingTerminalDock,
  width?: number,
) {
  try {
    const retained = parseDocks(
      storage.getItem(FLOATING_TERMINAL_DOCK_KEY),
    ).filter((entry) => entry.id !== id);
    storage.setItem(
      FLOATING_TERMINAL_DOCK_KEY,
      JSON.stringify(
        [...retained, { id, dock, ...(width ? { width } : {}) }].slice(
          -MAX_SAVED_GEOMETRIES,
        ),
      ),
    );
  } catch {
    // A presentation preference must never prevent terminal use.
  }
}

function parseDocks(
  raw: string | null,
): { id: string; dock: FloatingTerminalDock; width?: number }[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const { id, dock, width } = candidate as Record<string, unknown>;
    return typeof id === "string" &&
      id.length > 0 &&
      id.length <= 1_024 &&
      typeof dock === "string" &&
      DOCKS.has(dock)
      ? [
          {
            id,
            dock: dock as FloatingTerminalDock,
            ...(typeof width === "number" &&
            Number.isFinite(width) &&
            width > 0 &&
            width <= 100_000 &&
            (dock === "left" || dock === "right")
              ? { width }
              : {}),
          },
        ]
      : [];
  });
}
