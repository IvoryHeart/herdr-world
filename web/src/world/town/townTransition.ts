/**
 * How Town changes when its desks, rooms or hosts change: what was drawn
 * stays until its replacement is drawn, new buildings fade in, removed ones
 * fade out, and buildings that move glide to their new spots. The camera
 * glides with the same timing (scene/townSceneCamera.ts) so what the user
 * was looking at stays in place. Under reduced motion every change is
 * instant, and still never shows a blank or half-drawn frame.
 *
 * A host entering or leaving the town (added or removed in Manage
 * connections, ticked or unticked in Hosts) is a bigger event
 * (townHostPlan): its neighbours, the roads and the camera take longer to
 * make room or close the gap, a new host's building rises out of its lot
 * once they have begun, springing a little past its height before it
 * settles, and a leaving one stretches up, then sinks into its lot, both
 * raising dust along their base. Several hosts at once go one after
 * another. A host that only disconnects keeps its building; opening Town
 * places the buildings it already has without either.
 */

import { TOWN_LAND_OBJECT_REACH, townWildLine } from "./townLandscape";
import { TOWN_FACADE, TOWN_TILE as T, type TownLayout } from "./townLayout";

/** Seconds a glide or fade lasts. */
export const TOWN_TRANSITION_SECONDS = 0.3;

/** The easing every topology transition and its camera glide share. */
export const townEase = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Neighbours, roads and the camera making room for a host or closing its gap. */
export const TOWN_HOST_GLIDE_SECONDS = 0.6;
/** A new host's building starts to rise this long after its neighbours start to move. */
export const TOWN_HOST_RISE_DELAY = 0.2;
/** Seconds a new host's building takes to rise out of its lot. */
export const TOWN_HOST_RISE_SECONDS = 0.6;
/** Seconds a leaving host's building takes to sink into its lot. */
export const TOWN_HOST_SINK_SECONDS = 0.5;
/** Hosts that come or go together start this far apart, in reading order. */
export const TOWN_HOST_STAGGER = 0.12;
/** Past this many, the rest start with the last: a long list is not a parade. */
const TOWN_HOST_STAGGER_STEPS = 4;

/**
 * The hosts that entered or left the town between two layouts, and when each
 * one's building rises or sinks (seconds into the change). Null when the
 * same hosts are there (or there was no town before: nothing replays).
 */
export type TownHostPlan = {
  /** Seconds the neighbours, roads and camera take (TOWN_HOST_GLIDE_SECONDS). */
  seconds: number;
  /** Arriving hosts: when their building starts to rise. */
  rise: ReadonlyMap<string, number>;
  /** Leaving hosts: when their building starts to sink. */
  sink: ReadonlyMap<string, number>;
};

type PlacedBuilding = { hostKey: string; x: number; y: number };
const readingOrder = (a: PlacedBuilding, b: PlacedBuilding) =>
  a.y - b.y || a.x - b.x;
const staggered = (buildings: PlacedBuilding[], start: number) =>
  new Map(
    [...buildings]
      .sort(readingOrder)
      .map((building, index) => [
        building.hostKey,
        start + Math.min(index, TOWN_HOST_STAGGER_STEPS) * TOWN_HOST_STAGGER,
      ]),
  );

export function townHostPlan(
  previous: Pick<TownLayout, "buildings"> | null,
  next: Pick<TownLayout, "buildings">,
): TownHostPlan | null {
  if (!previous || previous === next) return null;
  const was = new Set(previous.buildings.map((b) => b.hostKey));
  const now = new Set(next.buildings.map((b) => b.hostKey));
  const arrived = next.buildings.filter((b) => !was.has(b.hostKey));
  const left = previous.buildings.filter((b) => !now.has(b.hostKey));
  if (!arrived.length && !left.length) return null;
  return {
    seconds: TOWN_HOST_GLIDE_SECONDS,
    rise: staggered(arrived, TOWN_HOST_RISE_DELAY),
    sink: staggered(left, 0),
  };
}

/** Seconds a layout change's glides take: longer when hosts come or go. */
export const townTransitionSeconds = (
  previous: Pick<TownLayout, "buildings"> | null,
  next: Pick<TownLayout, "buildings">,
) => townHostPlan(previous, next)?.seconds ?? TOWN_TRANSITION_SECONDS;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * A rising building `u` (0..1) of the way up: its height and width scale,
 * about the middle of its base, and its opacity. It shoots up a little past
 * its height (easing out with a spring) while narrow, then settles; it is
 * wide and flat as it breaks ground.
 */
export function townRisePose(u: number) {
  const x = clamp01(u) - 1;
  // easeOutBack: 0 -> about 1.08 near u = 0.75 -> 1.
  const sy = Math.max(0, 1 + 2.4 * x * x * x + 1.4 * x * x);
  return {
    sx: Math.min(1.2, Math.max(0.95, 1 + (1 - sy) * 0.25)),
    sy: u >= 1 ? 1 : sy,
    alpha: clamp01(u * 6),
  };
}

/**
 * A sinking building `v` (0..1) of the way down: it stretches up a little,
 * then sinks into its lot, spreading as it flattens, and fades at the end.
 */
export function townSinkPose(v: number) {
  const u = clamp01(v);
  const sy =
    u < 0.2
      ? 1 + 0.05 * Math.sin((Math.PI * u) / 0.2)
      : 1 - ((u - 0.2) / 0.8) ** 2;
  return {
    sx: Math.min(1.2, Math.max(0.95, 1 + (1 - sy) * 0.25)),
    sy: u >= 1 ? 0 : sy,
    alpha: u < 0.7 ? 1 : 1 - townEase((u - 0.7) / 0.3),
  };
}

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
  /** Seconds the whole motion takes (TOWN_TRANSITION_SECONDS when unset). */
  seconds?: number;
  /**
   * A host arriving: its building enters by rising out of its lot, for
   * TOWN_HOST_RISE_SECONDS from this many seconds into the motion
   * (townRisePose), instead of fading in. Negative when a rebake took over
   * a rise already under way (townRiseCarried).
   */
  rise?: number;
  /** A rising building has raised its dust. */
  dusted?: boolean;
};

/** How far up a rising building is (0..1), or null for one that does not rise. */
export function townRiseProgress(motion: TownBuildingMotion) {
  if (motion.rise === undefined) return null;
  // A motion lasts at least until its rise ends.
  if (motion.t >= 1) return 1;
  return townRiseAt(
    motion.t * (motion.seconds ?? TOWN_TRANSITION_SECONDS),
    motion.rise,
  );
}

/** How far up (0..1) a building is `seconds` in, when its rise starts at `rise`. */
export const townRiseAt = (seconds: number, rise: number) =>
  clamp01((seconds - rise) / TOWN_HOST_RISE_SECONDS);

/**
 * When, from now, a building in motion starts (or started: negative) to
 * rise, so a drawing that replaces it, or the one leaving as it is
 * replaced, rises on from the same height. Null when it is not rising or
 * already stands.
 */
export function townRiseCarried(motion: TownBuildingMotion) {
  if (motion.rise === undefined) return null;
  const start =
    motion.rise - motion.t * (motion.seconds ?? TOWN_TRANSITION_SECONDS);
  return start <= -TOWN_HOST_RISE_SECONDS ? null : start;
}

/**
 * The drawn offset and opacity of a building in motion. A rising building's
 * opacity is its plaques' and sign's (townBuildingLayers.ts): they appear
 * as it reaches its height. Its own drawing follows townRisePose.
 */
export function townMotionPose(motion: TownBuildingMotion) {
  const e = townEase(motion.t);
  const rise = townRiseProgress(motion);
  return {
    x: motion.dx * (1 - e) || 0,
    y: motion.dy * (1 - e) || 0,
    alpha: rise !== null ? townEase((rise - 0.6) / 0.4) : motion.enter ? e : 1,
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
export const TOWN_GROUND_CHUNK = 512;

/**
 * The ground painted from the layout, in world pixels: the town's own land
 * out to its wild line (townLandscape.ts), and as far again as a tree or
 * shrub there draws. Beyond it the land is the wild's alone, the same
 * pixels the repeated wild square shows (townRendererTopology.ts).
 */
export function townLandRect(layout: TownLayout): TownRect {
  const line = townWildLine(layout);
  const r = TOWN_LAND_OBJECT_REACH;
  const reach = Math.max(r.left, r.right, r.up, r.down);
  const x = (line.x0 - reach) * T;
  const y = (line.y0 - reach) * T;
  return {
    x,
    y,
    w: (line.x1 + reach) * T - x,
    h: (line.y1 + reach) * T - y,
  };
}

/**
 * The parts of `view` outside `land`, in whole world pixels: at most a band
 * above, one below and one each side between them. The repeated wild land
 * fills them (townRendererTopology.ts), so the map fills the view.
 */
export function townWildBands(land: TownRect, view: TownRect): TownRect[] {
  const x0 = Math.floor(view.x);
  const y0 = Math.floor(view.y);
  const x1 = Math.ceil(view.x + view.w);
  const y1 = Math.ceil(view.y + view.h);
  const top = Math.min(y1, Math.max(y0, land.y));
  const bottom = Math.max(top, Math.min(y1, land.y + land.h));
  const left = Math.min(x1, Math.max(x0, land.x));
  const right = Math.max(left, Math.min(x1, land.x + land.w));
  const bands = [
    { x: x0, y: y0, w: x1 - x0, h: top - y0 },
    { x: x0, y: bottom, w: x1 - x0, h: y1 - bottom },
    { x: x0, y: top, w: left - x0, h: bottom - top },
    { x: right, y: top, w: x1 - right, h: bottom - top },
  ];
  return bands.filter((band) => band.w > 0 && band.h > 0);
}

/** The ground chunks of `layout` that meet `view`, cut to its land. */
export function townGroundChunks(layout: TownLayout, view: TownRect) {
  const chunks: { key: string; region: TownRect }[] = [];
  const land = townLandRect(layout);
  const x0 = Math.max(view.x, land.x);
  const y0 = Math.max(view.y, land.y);
  const x1 = Math.min(view.x + view.w, land.x + land.w);
  const y1 = Math.min(view.y + view.h, land.y + land.h);
  if (x1 <= x0 || y1 <= y0) return chunks;
  const C = TOWN_GROUND_CHUNK;
  for (let cy = Math.floor(y0 / C); cy < Math.ceil(y1 / C); cy += 1)
    for (let cx = Math.floor(x0 / C); cx < Math.ceil(x1 / C); cx += 1) {
      const x = Math.max(cx * C, land.x);
      const y = Math.max(cy * C, land.y);
      chunks.push({
        key: `${cx},${cy}`,
        region: {
          x,
          y,
          w: Math.min((cx + 1) * C, land.x + land.w) - x,
          h: Math.min((cy + 1) * C, land.y + land.h) - y,
        },
      });
    }
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
  for (const { key } of townGroundChunks(layout, view))
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
