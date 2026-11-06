import type { Container, Graphics, Sprite } from "pixi.js";
import { townHash, townScreen, type TownCanvas } from "./townSprites";
import type { TownViewport } from "./townCamera";

/** Include ancestry so roofs and culled buildings suppress interior animation. */
export function townSpriteVisible(
  sprite: Sprite | Graphics,
  viewport: TownViewport,
) {
  for (let node: Container | null = sprite; node; node = node.parent)
    if (!node.visible || node.alpha <= 0) return false;
  const bounds = sprite.getBounds();
  return (
    bounds.maxX > 0 &&
    bounds.maxY > 0 &&
    bounds.minX < viewport.width &&
    bounds.minY < viewport.height
  );
}

/** Earliest visible animation change, in the renderer's seconds clock. */
export class TownAmbient {
  next = Infinity;
  constructor(readonly now: number) {}

  at(time: number) {
    this.next = Math.min(this.next, Math.max(this.now, time));
  }

  /** A discrete sprite frame, including its existing phase offset. */
  every(rate: number, phase = 0) {
    this.at((Math.floor(this.now * rate + phase) + 1 - phase) / rate);
  }

  continuous() {
    this.next = this.now;
  }
}

/** Each renderer retains its own blink phase, including while a sprite is hidden. */
export function createTownBlink() {
  const blinkAt = new Map<string, number>();
  return (
    key: string,
    clock: number,
    onScreen: boolean,
    ambient: TownAmbient,
  ) => {
    let next = blinkAt.get(key);
    if (next === undefined) next = clock + 1 + (townHash(key) % 400) / 100;
    if (clock > next + 0.13)
      next = clock + 2 + (townHash(`${key}${Math.floor(clock)}`) % 400) / 100;
    blinkAt.set(key, next);
    if (onScreen) ambient.at(clock <= next ? next + 0.0001 : next + 0.1301);
    return clock > next && clock < next + 0.13;
  };
}

/** Reuse screen art between discrete frames and status refreshes. */
export function createTownScreenResolver() {
  const canvases = new Map<string, TownCanvas>();
  return (state: string, frame: number) => {
    const step =
      state === "working"
        ? frame % 7
        : state === "off"
          ? 0
          : state === "idle" || state === "unknown"
            ? Math.floor(frame / 6) % 36
            : frame % 2;
    const key = `${state}:${step}`;
    let canvas = canvases.get(key);
    if (!canvas) canvases.set(key, (canvas = townScreen(state, step)));
    return canvas;
  };
}
