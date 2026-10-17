import { CanvasSource, FillPattern, Matrix, Texture } from "pixi.js";
import type { Graphics } from "pixi.js";
import { OFFICE_GEOMETRY } from "./officeGeometry";

/** Renderer-owned, bounded palette: two by two tiles replace thousands of paths. */
export class OfficeFloorTextures {
  private textures = new Map<string, Texture>();

  draw(
    graphics: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    first: number,
    second: number,
  ) {
    if (width <= 0 || height <= 0) return;
    const tile = OFFICE_GEOMETRY.tile;
    // Fractional tile edges have per-cell MSAA coverage in the vector baseline.
    // Retain those paths rather than changing seams when a room is centred.
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      for (let offsetY = 0; offsetY < height; offsetY += tile) {
        for (let offsetX = 0; offsetX < width; offsetX += tile) {
          graphics
            .rect(x + offsetX, y + offsetY, tile, tile)
            .fill(((offsetX + offsetY) / tile) % 2 === 0 ? first : second);
        }
      }
      return;
    }
    const key = `${first}:${second}`;
    let texture = this.textures.get(key);
    if (!texture) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = tile * 2;
      const context = canvas.getContext("2d")!;
      context.fillStyle = `#${first.toString(16).padStart(6, "0")}`;
      context.fillRect(0, 0, tile * 2, tile * 2);
      context.fillStyle = `#${second.toString(16).padStart(6, "0")}`;
      context.fillRect(tile, 0, tile, tile);
      context.fillRect(0, tile, tile, tile);
      texture = new Texture({
        source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
      });
      this.textures.set(key, texture);
    }
    const pattern = new FillPattern(texture, "repeat");
    pattern.setTransform(new Matrix().translate(x, y));
    // The original floor includes complete edge tiles, even at fractional bounds.
    graphics
      .rect(
        x,
        y,
        Math.ceil(width / tile) * tile,
        Math.ceil(height / tile) * tile,
      )
      .fill(pattern);
  }

  destroy() {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }
}
