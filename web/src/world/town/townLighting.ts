/**
 * Town's light is its status language. The scene is multiplied by a
 * half-resolution lightmap: the sky's ambient colour (townDaylight.ts) plus
 * every light in town, which shows as the sky darkens. Light follows where
 * agents are, not where they are going: a desk throws its seated agent's
 * state colour (blue-white working, amber waiting, green done); a room is lit
 * while an agent sits at a desk there working or waiting on you, and dark
 * otherwise; the bar is lit while anyone is at it. An agent walking to its
 * desk lights it when it sits down, and its desk and room go dark as it
 * stands up to leave. Street lamps and the town center light the streets. A
 * reception with someone waiting on you pulses amber over its lobby by day
 * and by night; under calm or reduced motion the pulse holds as a steady
 * mark.
 *
 * An agent with an open question for you waits on you whatever its runtime
 * status says: its reception pulses, as Town's reception and attention list
 * already treat it, and if it stays at its desk the desk throws amber and its
 * room is lit. A plain terminal (no agent to walk) asking a question throws
 * amber from its desk.
 *
 * `townLightPlan` decides what is lit from the town, its open questions and
 * where its agents are (`townPresence`); the Pixi side only draws it.
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
import type { TownActor } from "./townActors";
import { TOWN_NO_WEATHER, type TownSky } from "./townDaylight";
import {
  TOWN_LOBBY_HEIGHT,
  TOWN_TILE as T,
  townDeskTable,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import { townCanvas } from "./townSprites";
import { townBuildingOf } from "./townBuildings";

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

/** Whether a device is an agent Town draws: one that walks. */
const walks = (model: TownModel, device: OfficePaneDevice) =>
  Boolean(device.agentKey && model.agents.has(device.agentKey));

/**
 * The light a desk throws: its most urgent present occupant's state, or
 * none. An agent counts while seated there (`presence`); without a presence,
 * every agent counts as if it had arrived.
 */
export function townDeskLight(
  model: TownModel,
  deskKey: string,
  asking: TownAsking,
  presence?: TownPresence,
): TownDeskLight | null {
  return townDeskLighting(model, deskKey, asking, presence).light;
}

/** A desk's light, and whether a seated agent there lights its room. */
function townDeskLighting(
  model: TownModel,
  deskKey: string,
  asking: TownAsking,
  presence?: TownPresence,
) {
  let rank = -1;
  let room = false;
  for (const device of model.desks.get(deskKey)?.paneDevices ?? []) {
    const agent = walks(model, device);
    if (agent && presence && !presence.seated.has(device.agentKey!)) continue;
    const state = townDeskLightOf(model, device, asking) as TownDeskLight;
    rank = Math.max(rank, RANK.indexOf(state));
    room ||= agent && (state === "working" || state === "blocked");
  }
  return { light: RANK[rank] ?? null, room };
}

/** Where agents are now (`townPresence`). */
export type TownPresence = {
  /** Agents seated at their own desk: arrived, not walking to or from it. */
  seated: ReadonlySet<string>;
  /** Hosts with someone standing at the bar. */
  atBar: ReadonlySet<string>;
  /** Equal for equal presences. */
  key: string;
};

/**
 * Where agents are now, for Town's lights: a light changes when its agent
 * arrives, not when it sets off.
 */
export function townPresence(actors: Iterable<TownActor>): TownPresence {
  const seated = new Set<string>();
  const atBar = new Set<string>();
  for (const actor of actors)
    if (actor.mode === "seat" && actor.goal?.kind === "seat")
      seated.add(actor.key);
    else if (actor.mode === "stand" && actor.goal?.kind === "lounge")
      atBar.add(actor.hostKey);
  return {
    seated,
    atBar,
    key: `${[...seated].sort().join("\n")}\0${[...atBar].sort().join("\n")}`,
  };
}

/**
 * Relights from the town, its open questions and where its agents are now
 * (`town`, null before the first scene), but only when one of them changed,
 * as when an agent sat down, stood up or reached or left the bar: lights
 * change as agents arrive, not as they set off. An unchanged plan draws
 * nothing new either (lighting.sync compares).
 */
export function townRelighter(
  lighting: { sync(plan: TownLightPlan): void },
  town: () =>
    | readonly [
        TownLayout,
        TownModel,
        TownAsking | undefined,
        Iterable<TownActor>,
      ]
    | null,
) {
  let last: [TownLayout, TownModel, TownAsking | undefined, string] | null =
    null;
  return () => {
    const now = town();
    if (!now) return;
    const [layout, model, asking, actors] = now;
    const presence = townPresence(actors);
    if (
      last?.[0] === layout &&
      last[1] === model &&
      last[2] === asking &&
      last[3] === presence.key
    )
      return;
    last = [layout, model, asking, presence.key];
    lighting.sync(townLightPlan(layout, model, asking, presence));
  };
}

/** Everything lit in the town as it stands now. */
export function townLightPlan(
  layout: TownLayout,
  model: TownModel,
  asking: TownAsking = NO_ASKS,
  presence?: TownPresence,
): TownLightPlan {
  const plan: TownLightPlan = { areas: [], points: [], waiting: [] };
  // Hosts with someone waiting on you at reception: a blocked agent, or an
  // open question from an agent or a plain terminal.
  const waitingAt = new Set<string>();
  for (const { device } of model.projection.paneRoster)
    if (townDeskLightOf(model, device, asking) === "blocked")
      waitingAt.add(townBuildingOf(device));
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
    // The bar is lit while anyone is at it.
    const lounge = building.lounge;
    if (presence?.atBar.has(building.hostKey))
      plan.areas.push({
        x: lounge.x * T + 2,
        y: lounge.y * T + 2,
        w: lounge.w * T - 4,
        h: lounge.h * T - 4,
        feather: 18,
        color: WARM,
        power: 0.6,
      });
    for (const room of building.rooms) {
      let lit = false;
      for (const cell of room.cells) {
        if (!cell.deskKey) continue;
        const desk = townDeskLighting(model, cell.deskKey, asking, presence);
        lit ||= desk.room;
        const light = desk.light;
        if (!light) continue;
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
export const TOWN_LIGHT_FEATHER = 20;

export function radialTexture() {
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

export function softRectTexture() {
  const size = 64;
  const [canvas, g] = townCanvas(size, size);
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const t = Math.min(1, edge / TOWN_LIGHT_FEATHER);
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
  let sky: TownSky = {
    r: 1,
    g: 1,
    b: 1,
    lights: 0,
    sun: 1,
    shadowX: 0,
    shadowY: 0,
    clouds: 1,
    ...TOWN_NO_WEATHER,
  };
  let drawn = "";

  const softRect = (area: TownLightArea) => {
    const sprite = new NineSliceSprite({
      texture: soft,
      leftWidth: TOWN_LIGHT_FEATHER,
      rightWidth: TOWN_LIGHT_FEATHER,
      topHeight: TOWN_LIGHT_FEATHER,
      bottomHeight: TOWN_LIGHT_FEATHER,
    });
    // The edge is `feather` world pixels whatever the area's size.
    const k = area.feather / TOWN_LIGHT_FEATHER;
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
