/**
 * How Town changes when its desks, rooms or hosts change: what was drawn
 * stays until its replacement is drawn, new buildings fade in, removed ones
 * fade out, and buildings that move glide to their new spots. The camera
 * glides with the same timing (scene/townSceneCamera.ts) so what the user
 * was looking at stays in place. Under reduced motion every change is
 * instant, and still never shows a blank or half-drawn frame.
 */

import { TOWN_FACADE, TOWN_TILE as T, type TownLayout } from "./townLayout";

/** Seconds a glide or fade lasts. */
export const TOWN_TRANSITION_SECONDS = 0.3;

/** The easing every topology transition and its camera glide share. */
export const townEase = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** A building's motion: where it was drawn (px, relative to its new place) and how far along. */
export type TownBuildingMotion = {
  /** Offset at the start, in world pixels; the glide ends at 0. */
  dx: number;
  dy: number;
  /** A new building fades in; a moved or rebaked one is opaque. */
  enter: boolean;
  /**
   * Baked again over its old drawing: its interior and desks fade in over
   * the old ones (townCrossfadeAlpha), while its walls, plaques and walking
   * agents stay opaque.
   */
  crossfade: boolean;
  /** Progress, 0..1. */
  t: number;
};

/** The drawn offset and opacity of a building in motion. */
export function townMotionPose(motion: TownBuildingMotion) {
  const e = townEase(motion.t);
  return {
    x: motion.dx * (1 - e) || 0,
    y: motion.dy * (1 - e) || 0,
    alpha: motion.enter ? e : 1,
  };
}

/** The opacity of a rebaked building's interior and desks as they fade in. */
export function townCrossfadeAlpha(motion: TownBuildingMotion) {
  return motion.crossfade ? townEase(motion.t) : 1;
}

/**
 * How a drawing being replaced is covered by its replacement: wholly (the
 * new building is at least as large), in part (it shrank), or not at all
 * (its host is gone).
 */
export type TownCover = "whole" | "part" | "none";

/**
 * The opacity of a drawing being replaced. One wholly under its replacement
 * stays opaque until the replacement has faded in over it, so what changed
 * crossfades and the rest never changes; one partly under holds for the
 * first half, then fades where the smaller replacement leaves ground; one
 * leaving on its own fades all the way.
 */
export function townRetiringAlpha(t: number, cover: TownCover) {
  if (cover === "none") return 1 - townEase(t);
  if (cover === "whole") return t < 1 ? 1 : 0;
  return t < 0.5 ? 1 : 1 - townEase((t - 0.5) * 2);
}

/** A world rectangle in pixels. */
export type TownRect = { x: number; y: number; w: number; h: number };

/** A building's drawn extent, roof and façade included. */
export function townBuildingRect(building: {
  x: number;
  y: number;
  w: number;
  h: number;
}): TownRect {
  return {
    x: building.x * T - 4,
    y: (building.y - 1) * T,
    w: building.w * T + 8,
    h: (building.h + 1 + TOWN_FACADE) * T,
  };
}

export const townRectsMeet = (a: TownRect, b: TownRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The ground is painted in square chunks of this many world pixels. */
export const TOWN_GROUND_CHUNK = 256;

/**
 * The ground chunks that meet `view`. The ground covers the whole map, the
 * town and the generated land beyond it (townLandscape.ts), so chunks
 * continue past the town's edges wherever the camera looks.
 */
export function townGroundChunks(view: TownRect) {
  const chunks: { key: string; region: TownRect }[] = [];
  const cx0 = Math.floor(view.x / TOWN_GROUND_CHUNK);
  const cy0 = Math.floor(view.y / TOWN_GROUND_CHUNK);
  const cx1 = Math.ceil((view.x + view.w) / TOWN_GROUND_CHUNK);
  const cy1 = Math.ceil((view.y + view.h) / TOWN_GROUND_CHUNK);
  for (let cy = cy0; cy < cy1; cy += 1)
    for (let cx = cx0; cx < cx1; cx += 1)
      chunks.push({
        key: `${cx},${cy}`,
        region: {
          x: cx * TOWN_GROUND_CHUNK,
          y: cy * TOWN_GROUND_CHUNK,
          w: TOWN_GROUND_CHUNK,
          h: TOWN_GROUND_CHUNK,
        },
      });
  return chunks;
}

/** A desk's drawn extent (its pod: people, screens, glow). */
export function townDeskRect(cell: { x: number; y: number }): TownRect {
  return { x: (cell.x + 1) * T - 20, y: cell.y * T - 20, w: 104, h: 90 };
}

/** What a frame draws, as the gap check reads it. */
export type TownDrawnScene = {
  /** The ground chunks painted for the current layout. */
  ground: ReadonlySet<string>;
  /** Each host's building as drawn: the layout key it was baked from, and its desks with pods. */
  buildings: ReadonlyMap<
    string,
    { key: string; pods: ReadonlySet<string> | null }
  >;
};

/**
 * What is missing from a frame of `layout` seen through `view`: ground
 * chunks not painted, buildings not drawn (or drawn from an older layout)
 * and, when desks are detailed, desks without their pods. Empty when the
 * frame is whole.
 */
export function townSceneGaps(
  layout: TownLayout,
  view: TownRect,
  drawn: TownDrawnScene,
  buildingKey: (building: TownLayout["buildings"][number]) => string,
  detailed: boolean,
) {
  const gaps: string[] = [];
  for (const { key } of townGroundChunks(view))
    if (!drawn.ground.has(key)) gaps.push(`ground ${key}`);
  for (const building of layout.buildings) {
    if (!townRectsMeet(townBuildingRect(building), view)) continue;
    const shown = drawn.buildings.get(building.hostKey);
    if (!shown || shown.key !== buildingKey(building)) {
      gaps.push(`building ${building.hostKey}`);
      continue;
    }
    if (!detailed || !shown.pods) continue;
    for (const room of building.rooms)
      for (const cell of room.cells)
        if (
          cell.deskKey &&
          townRectsMeet(townDeskRect(cell), view) &&
          !shown.pods.has(cell.deskKey)
        )
          gaps.push(`desk ${cell.deskKey}`);
  }
  return gaps;
}
