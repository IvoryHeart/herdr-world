import { CanvasSource, Texture } from "pixi.js";
import { profileLookFor, profilesSnapshot } from "../agentProfiles";
import type { TownModel } from "./townModel";
import { townLookFor, type TownCanvas, type TownLook } from "./townSprites";

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

/**
 * An agent's look: the profile's when it was launched from one, otherwise
 * derived from its identity. Cached until the profiles change.
 */
export function townLooks(agents: () => TownModel["agents"] | undefined) {
  const looks = new Map<string, TownLook>();
  let looksRevision = -1;
  return (key: string) => {
    const profiles = profilesSnapshot();
    if ((profiles?.revision ?? -1) !== looksRevision) {
      looks.clear();
      looksRevision = profiles?.revision ?? -1;
    }
    const terminal = agents()?.get(key)?.currentTerminalRef;
    const cacheKey = `${key}|${terminal?.nativeId ?? ""}`;
    let look = looks.get(cacheKey);
    if (!look) {
      look =
        (terminal &&
          profileLookFor(profiles, terminal.connectionId, terminal.nativeId)) ||
        townLookFor(key);
      looks.set(cacheKey, look);
    }
    return look;
  };
}
