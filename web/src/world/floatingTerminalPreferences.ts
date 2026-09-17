import {
  clampFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
  type FloatingTerminalSize,
} from "./floatingTerminalGeometry";
import type { WorldFloatingTerminal } from "./worldTerminalPresentation";

export const FLOATING_TERMINAL_GEOMETRY_KEY =
  "worldFloatingTerminalGeometry:v1";
const MAX_SAVED_GEOMETRIES = 64;

type GeometryStorage = Pick<Storage, "getItem" | "setItem">;
type SavedGeometry = { id: string; geometry: FloatingTerminalGeometry };

export function floatingTerminalGeometryId(
  terminal: Pick<WorldFloatingTerminal, "connectionId" | "terminalId">,
) {
  return JSON.stringify([terminal.connectionId, terminal.terminalId]);
}

export function readFloatingTerminalGeometry(
  storage: GeometryStorage,
  id: string,
  fallback: FloatingTerminalGeometry,
  viewport: FloatingTerminalSize,
) {
  try {
    const saved = parseSaved(storage.getItem(FLOATING_TERMINAL_GEOMETRY_KEY));
    const geometry = saved.find((entry) => entry.id === id)?.geometry;
    return clampFloatingTerminalGeometry(geometry ?? fallback, viewport);
  } catch {
    return clampFloatingTerminalGeometry(fallback, viewport);
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
