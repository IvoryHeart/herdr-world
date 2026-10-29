import { CanvasSource, Texture } from "pixi.js";
import type { TownCanvas } from "./townSprites";

const textureCache = new WeakMap<TownCanvas, Texture>();
/** One crisp (nearest-neighbour) texture per sprite canvas. */
export function textureOf(canvas: TownCanvas) {
  let texture = textureCache.get(canvas);
  if (!texture) {
    texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
    });
    textureCache.set(canvas, texture);
  }
  return texture;
}
