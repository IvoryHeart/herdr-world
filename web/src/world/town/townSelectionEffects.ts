import { Graphics } from "pixi.js";
import type { TownActors } from "./townActors";
import type { TownCamera } from "./townCamera";
import {
  TOWN_TILE as T,
  townSeat,
  type TownLayout,
  type TownCell,
} from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownSceneState } from "./townRenderer";
import { type TownAmbient, townSpriteVisible } from "./townAmbient";
import { townSearchRect, type TownActorPosition } from "./townSearch";
import { TOWN_FACADE } from "./townLayout";

/** The dim over what a search did not find: Town's room dim, lighter. */
const SEARCH_DIM = { color: 0x0e1220, alpha: 0.26 };
/** A match's outline: Town's text cream (`--town-text`). */
const SEARCH_LIGHT = 0xf1efe6;
/** The chosen match's pulse: Town's accent (`--town-accent`). */
const SEARCH_PULSE = 0xffd166;
/** Seconds the chosen match pulses for. */
export const TOWN_SEARCH_PULSE_SECONDS = 2;

/** When the chosen match's pulse began, by its request. */
export type TownSearchPulseClock = { seq: number | null; start: number };

/**
 * A search on the map: everything without a match dims a little (whole
 * buildings, or rooms where roofs are off), each match is outlined, and the
 * chosen one pulses briefly, never under calm or reduced motion.
 */
function drawTownSearch(
  fxLayer: Graphics,
  model: TownModel,
  layout: TownLayout,
  state: TownSceneState,
  camera: TownCamera,
  clock: number,
  ambient: TownAmbient,
  actorPosition: TownActorPosition,
  roofAlpha: (hostKey: string) => number,
  pulseClock: TownSearchPulseClock,
) {
  // No match leaves Town as it is: "No matches" says so.
  const search = state.search;
  if (!search?.keys.size) return;
  for (const building of layout.buildings) {
    if (!search.hosts.has(building.hostKey))
      fxLayer
        .rect(
          building.x * T,
          building.y * T,
          building.w * T,
          (building.h + TOWN_FACADE) * T,
        )
        .fill(SEARCH_DIM);
    else if (
      !search.keys.has(building.hostKey) &&
      roofAlpha(building.hostKey) < 0.5
    )
      for (const room of building.rooms)
        if (!search.rooms.has(room.key))
          fxLayer
            .rect(room.x * T, room.y * T, room.w * T, room.h * T)
            .fill(SEARCH_DIM);
  }
  const width = 2 / Math.max(0.35, camera.z) + 0.5;
  for (const key of search.keys) {
    const rect = townSearchRect(key, model, layout, actorPosition);
    if (!rect) continue;
    fxLayer
      .roundRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 4)
      .stroke({ color: SEARCH_LIGHT, width, alpha: 0.9 });
  }
  const pulse = search.pulse;
  if (!pulse) return;
  if (pulseClock.seq !== pulse.seq) {
    pulseClock.seq = pulse.seq;
    pulseClock.start = clock;
  }
  const age = clock - pulseClock.start;
  if (
    state.calm ||
    camera.reducedMotion ||
    age < 0 ||
    age > TOWN_SEARCH_PULSE_SECONDS
  )
    return;
  const rect = townSearchRect(pulse.key, model, layout, actorPosition);
  if (!rect) return;
  // Two rings swell outward and fade.
  for (const phase of [0, 0.5]) {
    const t = (((age / 0.8 + phase) % 1) + 1) % 1;
    const grow = (6 + t * 22) / Math.max(0.35, camera.z);
    fxLayer
      .roundRect(
        rect.x - grow,
        rect.y - grow,
        rect.w + grow * 2,
        rect.h + grow * 2,
        6,
      )
      .stroke({ color: SEARCH_PULSE, width: width * 1.5, alpha: 1 - t });
  }
  ambient.continuous();
}

/** Existing selection/hover art, including its visible pulse deadline. */
export function drawTownSelectionEffects(
  fxLayer: Graphics,
  model: TownModel | null,
  layout: TownLayout | null,
  actors: TownActors,
  layoutCells: ReadonlyMap<string, TownCell>,
  state: TownSceneState,
  camera: TownCamera,
  clock: number,
  ambient: TownAmbient,
  search?: {
    actorPosition: TownActorPosition;
    roofAlpha: (hostKey: string) => number;
    pulseClock: TownSearchPulseClock;
  },
) {
  fxLayer.clear();
  if (!model) return;
  if (layout && search)
    drawTownSearch(
      fxLayer,
      model,
      layout,
      state,
      camera,
      clock,
      ambient,
      search.actorPosition,
      search.roofAlpha,
      search.pulseClock,
    );
  const ring = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: number,
    alpha: number,
  ) => {
    fxLayer
      .ellipse(x, y, rx, ry)
      .stroke({ color, width: 1.5 / Math.max(0.5, camera.z) + 0.5, alpha });
    fxLayer.ellipse(x, y, rx, ry).fill({ color, alpha: alpha * 0.2 });
    const point = camera.toScreen(x, y);
    if (
      color === 0xffd166 &&
      point.x + rx * camera.z > 0 &&
      point.y + ry * camera.z > 0 &&
      point.x - rx * camera.z < camera.viewport.width &&
      point.y - ry * camera.z < camera.viewport.height
    )
      ambient.continuous();
  };
  for (const [key, color] of [
    [state.selectedKey, 0xffd166],
    [state.hoverKey !== state.selectedKey ? state.hoverKey : null, 0xffffff],
  ] as const) {
    if (!key) continue;
    const alpha = color === 0xffd166 ? 0.7 + 0.3 * Math.sin(clock * 5) : 0.45;
    const actor = actors.actors.get(key);
    if (actor && actor.mode !== "out") {
      if (actor.mode === "seat") {
        const seat = model.agentSeats.get(key);
        const cell = seat && layoutCells.get(seat.deskKey);
        if (cell && seat) {
          const geometry = townSeat(cell, seat.seat);
          ring(
            geometry.cx,
            geometry.top ? geometry.tableY + 17 : geometry.tableY + 56,
            11,
            4,
            color,
            alpha,
          );
        }
      } else ring(actor.x, actor.y, 10, 4, color, alpha);
      continue;
    }
    const cell = layoutCells.get(key);
    if (cell) {
      ring((cell.x + 3) * T, cell.y * T + 50, 38, 8, color, alpha);
      continue;
    }
    const room = layout?.buildings
      .flatMap((b) => b.rooms)
      .find((r) => r.key === key);
    if (room) {
      fxLayer
        .rect(room.x * T + 2, room.y * T + 2, room.w * T - 4, room.h * T - 4)
        .stroke({ color, width: 2, alpha });
      if (color === 0xffd166 && townSpriteVisible(fxLayer, camera.viewport))
        ambient.continuous();
    }
  }
}
