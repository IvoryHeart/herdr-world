/**
 * Town's light is its status language. The scene is multiplied by a
 * half-resolution lightmap: the sky's ambient colour (townDaylight.ts) plus
 * every light in town, which shows as the sky darkens. A room with work in it
 * is lit and a quiet one stays dark; each desk throws its agent's state
 * colour (blue-white working, amber waiting, green done); street lamps and the
 * town center light the streets. A reception with someone waiting on you
 * pulses amber over its lobby by day and by night; under calm or reduced
 * motion the pulse holds as a steady mark.
 *
 * An agent with an open question for you waits on you whatever its runtime
 * status says: its desk throws amber, its room is lit and its reception
 * pulses, as Town's reception and attention list already treat it.
 *
 * `townLightPlan` decides what is lit from the town and its open questions;
 * the Pixi side only draws it.
 */

import {
  type Application,
  CanvasSource,
  Container,
  NineSliceSprite,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";
import type { OfficePaneDevice } from "../herdrOfficeProjection";
import type { TownSky } from "./townDaylight";
import {
  TOWN_LOBBY_HEIGHT,
  TOWN_TILE as T,
  townDeskTable,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import { townCanvas } from "./townSprites";

/** A desk's light: its most urgent agent's state. */
export type TownDeskLight = "blocked" | "working" | "done";

export const TOWN_STATE_LIGHT: Record<TownDeskLight, number> = {
  working: 0xcfe6ff,
  blocked: 0xffb24a,
  done: 0x9df0ae,
};
const WARM = 0xffe2b0;
const LAMP = 0xffd08a;
/** The amber a reception pulses while someone waits there. */
export const TOWN_WAITING_AMBER = 0xffa62e;

export type TownLightArea = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Soft edge, in world pixels. */
  feather: number;
  color: number;
  /** Brightness at full night, 0–1. */
  power: number;
};
export type TownLightPoint = {
  x: number;
  y: number;
  radius: number;
  color: number;
  power: number;
};
export type TownLightPlan = {
  /** Light added into the lightmap; it shows as the sky darkens. */
  areas: TownLightArea[];
  points: TownLightPoint[];
  /** Lobbies where someone waits on you: amber over the scene, day or night. */
  waiting: TownLightArea[];
};

const RANK: readonly TownDeskLight[] = ["done", "working", "blocked"];

/**
 * Open questions, keyed as Town's reception keys them: an agent's key, or a
 * plain terminal's node ID.
 */
type TownAsking = ReadonlySet<string>;
const NO_ASKS: TownAsking = new Set();

const asks = (device: OfficePaneDevice, asking: TownAsking) =>
  asking.has(device.agentKey ?? device.nodeId);

/** A seat's state: a question for you is waiting, whatever the runtime says. */
const townDeskLightOf = (
  model: TownModel,
  device: OfficePaneDevice,
  asking: TownAsking,
) =>
  asks(device, asking)
    ? "blocked"
    : model.agents.get(device.agentKey!)?.semanticStatus;

/** The light a desk throws: its most urgent agent's state, or none. */
export function townDeskLight(
  model: TownModel,
  deskKey: string,
  asking: TownAsking,
): TownDeskLight | null {
  let rank = -1;
  for (const device of model.desks.get(deskKey)?.paneDevices ?? [])
    rank = Math.max(
      rank,
      RANK.indexOf(townDeskLightOf(model, device, asking) as TownDeskLight),
    );
  return RANK[rank] ?? null;
}

/** Whether a room has work in it: someone working or waiting on you. */
export function townRoomLit(model: TownModel, roomKey: string) {
  const counts = model.roomCounts.get(roomKey);
  return Boolean(counts && counts.working + counts.blocked > 0);
}

/** Everything lit in the town as it stands now. */
export function townLightPlan(
  layout: TownLayout,
  model: TownModel,
  asking: TownAsking = NO_ASKS,
): TownLightPlan {
  const plan: TownLightPlan = { areas: [], points: [], waiting: [] };
  // Hosts with someone waiting on you at reception: a blocked agent, or an
  // open question from an agent or a plain terminal.
  const waitingAt = new Set<string>();
  for (const { device } of model.projection.paneRoster)
    if (townDeskLightOf(model, device, asking) === "blocked")
      waitingAt.add(device.hostKey);
  for (const lamp of layout.lamps)
    plan.points.push({
      x: lamp.x * T + 8,
      y: lamp.y * T + 2,
      radius: 96,
      color: LAMP,
      power: 0.8,
    });
  const center = layout.center;
  plan.points.push({
    x: (center.x + center.w / 2) * T,
    y: (center.y + center.h) * T - 8,
    radius: center.w * T * 0.62,
    color: WARM,
    power: 0.85,
  });
  for (const building of layout.buildings) {
    // A failed host's cached town is stale: its lights are out.
    if (model.hosts.get(building.hostKey)?.stale) continue;
    const bx = building.x * T;
    const by = building.y * T;
    const bw = building.w * T;
    const waiting = waitingAt.has(building.hostKey);
    const lobby = {
      x: bx + 6,
      y: by + 6,
      w: bw - 12,
      h: (building.lobbyY + TOWN_LOBBY_HEIGHT - building.y) * T - 6,
    };
    plan.areas.push({
      ...lobby,
      feather: 26,
      color: waiting ? TOWN_STATE_LIGHT.blocked : WARM,
      power: waiting ? 0.9 : 0.55,
    });
    if (waiting)
      plan.waiting.push({
        ...lobby,
        feather: 22,
        color: TOWN_WAITING_AMBER,
        power: 1,
      });
    for (const room of building.rooms) {
      let lit = townRoomLit(model, room.key);
      for (const cell of room.cells) {
        const light =
          cell.deskKey && townDeskLight(model, cell.deskKey, asking);
        if (!light) continue;
        // An open question at a desk lights its room as a blocked agent does.
        lit ||= light === "blocked";
        const table = townDeskTable(cell.seats);
        plan.points.push({
          x: (cell.x + 1) * T + table.x + table.w / 2,
          y: cell.y * T + 28,
          radius: 64,
          color: TOWN_STATE_LIGHT[light],
          power: 0.95,
        });
      }
      if (lit)
        plan.areas.push({
          x: room.x * T + 2,
          y: room.y * T + 2,
          w: room.w * T - 4,
          h: room.h * T - 4,
          feather: 18,
          color: WARM,
          power: 0.6,
        });
    }
  }
  return plan;
}

/** A waiting lobby's strength now: a slow pulse, or steady without motion. */
export const townWaitingPulse = (clock: number, animated: boolean) =>
  animated ? 0.65 + 0.35 * Math.sin(clock * 3.2) : 1;

/** How fast the waiting pulse is redrawn, in frames a second. */
export const TOWN_WAITING_PULSE_RATE = 15;

/* ---------- drawing ---------- */

const MAP_SCALE = 0.5;
const FEATHER = 20;

function radialTexture() {
  const [canvas, g] = townCanvas(128, 128);
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  // A bright core and a long soft skirt.
  for (let i = 0; i <= 10; i += 1)
    gradient.addColorStop(i / 10, `rgba(255,255,255,${(1 - i / 10) ** 2.2})`);
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  return new Texture({
    source: new CanvasSource({ resource: canvas, scaleMode: "linear" }),
  });
}

function softRectTexture() {
  const size = 64;
  const [canvas, g] = townCanvas(size, size);
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const t = Math.min(1, edge / FEATHER);
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  g.putImageData(image, 0, 0);
  return new Texture({
    source: new CanvasSource({ resource: canvas, scaleMode: "linear" }),
  });
}

export type TownLighting = ReturnType<typeof createTownLighting>;

export function createTownLighting(options: {
  app: Application;
  /** The lightmap, multiplied over the world and under screen-space marks. */
  mapLayer: Container;
  /** Over the lit world, in world coordinates: waiting lobbies. */
  glowLayer: Container;
}) {
  const { app, mapLayer, glowLayer } = options;
  const radial = radialTexture();
  const soft = softRectTexture();
  let map = RenderTexture.create({ width: 2, height: 2 });
  const mapSprite = new Sprite(map);
  mapSprite.blendMode = "multiply";
  mapLayer.addChild(mapSprite);
  // The lights, in world coordinates, drawn into the map at its scale. The
  // map renders `root`, so `lit` carries the camera as its own transform.
  const root = new Container();
  const lit = root.addChild(new Container());
  const waiting: { sprite: NineSliceSprite; area: TownLightArea }[] = [];
  const lights: { sprite: Sprite | NineSliceSprite; power: number }[] = [];
  let sky: TownSky = { r: 1, g: 1, b: 1, lights: 0 };
  let drawn = "";

  const softRect = (area: TownLightArea) => {
    const sprite = new NineSliceSprite({
      texture: soft,
      leftWidth: FEATHER,
      rightWidth: FEATHER,
      topHeight: FEATHER,
      bottomHeight: FEATHER,
    });
    // The edge is `feather` world pixels whatever the area's size.
    const k = area.feather / FEATHER;
    sprite.scale.set(k);
    sprite.position.set(area.x - area.feather / 2, area.y - area.feather / 2);
    sprite.width = (area.w + area.feather) / k;
    sprite.height = (area.h + area.feather) / k;
    sprite.tint = area.color;
    return sprite;
  };

  const clear = () => {
    for (const child of [
      ...lit.removeChildren(),
      ...glowLayer.removeChildren(),
    ])
      child.destroy();
    lights.length = waiting.length = 0;
  };

  return {
    /** Rebuild every light from a new plan; false when nothing changed. */
    sync(plan: TownLightPlan) {
      const key = JSON.stringify(plan);
      if (key === drawn) return false;
      drawn = key;
      clear();
      for (const area of plan.areas) {
        const sprite = lit.addChild(softRect(area));
        sprite.blendMode = "add";
        lights.push({ sprite, power: area.power });
      }
      for (const light of plan.points) {
        const sprite = lit.addChild(new Sprite(radial));
        sprite.anchor.set(0.5);
        sprite.position.set(light.x, light.y);
        sprite.width = sprite.height = light.radius * 2;
        sprite.tint = light.color;
        sprite.blendMode = "add";
        lights.push({ sprite, power: light.power });
      }
      for (const area of plan.waiting)
        waiting.push({ sprite: glowLayer.addChild(softRect(area)), area });
      return true;
    },
    resize(width: number, height: number) {
      const w = Math.max(2, Math.ceil(width * MAP_SCALE));
      const h = Math.max(2, Math.ceil(height * MAP_SCALE));
      if (map.width !== w || map.height !== h) {
        map.destroy(true);
        map = RenderTexture.create({ width: w, height: h });
        map.source.scaleMode = "linear";
        mapSprite.texture = map;
      }
      mapSprite.width = width;
      mapSprite.height = height;
    },
    /**
     * Set this frame's sky, camera and pulse. Returns whether a waiting lobby
     * is on screen (and so wants the pulse redrawn).
     */
    update(
      next: TownSky,
      world: Container,
      viewport: { width: number; height: number },
      pulse: number,
    ) {
      sky = next;
      const z = world.scale.x;
      lit.scale.set(z * MAP_SCALE);
      lit.position.set(
        world.position.x * MAP_SCALE,
        world.position.y * MAP_SCALE,
      );
      glowLayer.scale.copyFrom(world.scale);
      glowLayer.position.copyFrom(world.position);
      for (const light of lights) light.sprite.alpha = light.power * sky.lights;
      let onScreen = false;
      for (const { sprite, area } of waiting) {
        // Brighter at night, when it glows against the dark.
        sprite.alpha = area.power * pulse * (0.32 + 0.23 * sky.lights);
        const left = area.x * z + world.position.x;
        const top = area.y * z + world.position.y;
        onScreen ||=
          left < viewport.width &&
          top < viewport.height &&
          left + area.w * z > 0 &&
          top + area.h * z > 0;
      }
      return onScreen;
    },
    /** Draw the lightmap; call before the stage renders. Clear sky: none. */
    render(clearSky: boolean) {
      mapSprite.visible = !clearSky;
      if (clearSky) return;
      app.renderer.render({
        container: root,
        target: map,
        clear: true,
        clearColor: [sky.r, sky.g, sky.b, 1],
      });
    },
    destroy() {
      clear();
      root.destroy({ children: true });
      map.destroy(true);
      radial.destroy(true);
      soft.destroy(true);
    },
  };
}
