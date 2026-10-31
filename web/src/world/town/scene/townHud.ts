/**
 * What Town's HUD reads, headless: which buildings and rooms are on screen
 * (`visible`), the zoom level (`level`) and a 15-second clock for "waiting 3
 * min" ages (`ages`). Each topic publishes only when its value changes, so
 * drawn frames reach React only when what the HUD shows changes. The anchors
 * World draws its connector lines from are computed here too, in world
 * coordinates; the adapter places them on screen.
 */

import type { TownCamera, TownLevel } from "../townCamera";
import { findCell } from "../townCameraTargets";
import { TOWN_TILE as T, townSeat, type TownLayout } from "../townLayout";
import type { TownModel } from "../townModel";
import {
  NOTHING_VISIBLE,
  townVisibleHosts,
  type TownVisible,
} from "../townVisibleHosts";
import type { TownClock } from "./ports";

/** How often ages shown to the user move on. */
export const TOWN_AGES_MS = 15_000;

export type TownHudTopic = "visible" | "level" | "ages";

type Listener = () => void;

export class TownHud {
  visible: TownVisible = NOTHING_VISIBLE;
  level: TownLevel = "overview";
  /** Wall-clock milliseconds, moved on every 15 s while ages are shown. */
  ages: number;
  private readonly listeners = new Map<TownHudTopic, Set<Listener>>();
  private readonly frames = new Set<Listener>();
  private agesShown = 0;
  private cancelAges: (() => void) | null = null;

  constructor(private readonly clock: TownClock) {
    this.ages = clock.wall();
  }

  subscribe(topic: TownHudTopic, listener: Listener) {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(listener);
    this.listeners.set(topic, set);
    return () => {
      set.delete(listener);
    };
  }

  private publish(topic: TownHudTopic) {
    for (const listener of this.listeners.get(topic) ?? []) listener();
  }

  /** Each drawn frame, for what must follow the camera outside React. */
  onFrame(listener: Listener) {
    this.frames.add(listener);
    return () => {
      this.frames.delete(listener);
    };
  }

  /** The renderer drew a frame: publish what the HUD shows, if it changed. */
  drew(camera: TownCamera, level: TownLevel, layout: TownLayout) {
    const visible = townVisibleHosts(camera, layout, level);
    if (visible.key !== this.visible.key) {
      this.visible = visible;
      this.publish("visible");
    }
    if (level !== this.level) {
      this.level = level;
      this.publish("level");
    }
  }

  /** The frame is on screen, the world layer placed: notify its followers. */
  framed() {
    for (const listener of this.frames) listener();
  }

  /** Wall-clock now, for ages read when the HUD renders. */
  now() {
    return this.clock.wall();
  }

  /**
   * A HUD element shows ages: keep the 15 s clock running while any does.
   * Returns the function that stops showing them.
   */
  showAges() {
    this.agesShown += 1;
    if (this.agesShown === 1) {
      this.ages = this.clock.wall();
      this.tick();
    }
    let shown = true;
    return () => {
      if (!shown) return;
      shown = false;
      this.agesShown -= 1;
      if (this.agesShown === 0) {
        this.cancelAges?.();
        this.cancelAges = null;
      }
    };
  }

  private tick() {
    this.cancelAges = this.clock.after(TOWN_AGES_MS, () => {
      this.ages = this.clock.wall();
      this.publish("ages");
      this.tick();
    });
  }
}

/** A point World draws a connector to, in world pixels. */
export type TownWorldPoint = { x: number; y: number };

/**
 * Where an inspected key is, in world pixels: its agent (seated at its seat,
 * else where it stands) and its workbench (its desk).
 */
export function townWorldAnchor(
  key: string | null,
  model: TownModel,
  layout: TownLayout,
  actorPosition: (
    key: string,
  ) => { x: number; y: number; seated: boolean } | null,
): { agent: TownWorldPoint | null; workbench: TownWorldPoint | null } {
  if (!key) return { agent: null, workbench: null };
  const position = actorPosition(key);
  let agent: TownWorldPoint | null = null;
  if (position) {
    if (position.seated) {
      const seat = model.agentSeats.get(key);
      const cell = seat && findCell(layout, seat.deskKey);
      if (seat && cell) {
        const geometry = townSeat(cell, seat.seat);
        agent = {
          x: geometry.cx,
          y: geometry.top ? geometry.tableY + 6 : geometry.tableY + 40,
        };
      }
    } else agent = { x: position.x, y: position.y - 12 };
  }
  const deskKey = model.desks.has(key)
    ? key
    : (model.agentSeats.get(key)?.deskKey ?? model.devices.get(key)?.deskKey);
  const cell = deskKey ? findCell(layout, deskKey) : null;
  const workbench = cell ? { x: (cell.x + 3) * T, y: cell.y * T + 28 } : null;
  return { agent, workbench };
}

/** A screen rectangle, as the host element's client rectangle. */
export type TownRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * A world point on screen for World's connector lines: clamped 10 px inside
 * the town, with the edge it is beyond when off screen.
 */
export function townScreenAnchor(
  world: TownWorldPoint | null,
  camera: Pick<TownCamera, "toScreen">,
  rect: TownRect,
) {
  if (!world) return null;
  const screen = camera.toScreen(world.x, world.y);
  const x = rect.left + screen.x;
  const y = rect.top + screen.y;
  const visible =
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const edge: "left" | "right" | "top" | "bottom" | null = visible
    ? null
    : x < rect.left
      ? "left"
      : x > rect.right
        ? "right"
        : y < rect.top
          ? "top"
          : "bottom";
  return {
    x: Math.min(rect.right - 10, Math.max(rect.left + 10, x)),
    y: Math.min(rect.bottom - 10, Math.max(rect.top + 10, y)),
    visible,
    edge,
  };
}
