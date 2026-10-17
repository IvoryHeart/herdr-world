/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { CanvasSource, Texture } from "pixi.js";

export async function loadTexture(url: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  if (typeof image.decode === "function") {
    await image.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("character asset unavailable")),
        {
          once: true,
        },
      );
    });
  }
  if (typeof globalThis.createImageBitmap === "function") {
    return Texture.from(await globalThis.createImageBitmap(image));
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("character asset canvas unavailable");
  }
  context.drawImage(image, 0, 0);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function destroyTextures(textures: readonly Texture[]) {
  for (const texture of textures) {
    if (texture !== Texture.EMPTY) {
      texture.destroy(true);
    }
  }
}
