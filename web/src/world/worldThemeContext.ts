import type { WorldSurfaceContext } from "./WorldSurface";
import { isWorldSurfaceContext } from "./WorldSurface";
import type { HerdrGraphProjection } from "./graph/herdrGraphProjection";

export type WorldThemeContext = WorldSurfaceContext & {
  graphProjection: HerdrGraphProjection;
  onGraphSelect: (selectionKey: string, hostKey: string) => void;
};

export function isWorldThemeContext(value: unknown): value is WorldThemeContext {
  if (!isWorldSurfaceContext(value)) return false;
  const record = value as Partial<WorldThemeContext>;
  return Boolean(record.graphProjection) && typeof record.onGraphSelect === "function";
}
