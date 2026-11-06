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
) {
  fxLayer.clear();
  if (!model) return;
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
    if (actor) {
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
