import { CanvasSource, FillPattern, Matrix, Texture } from "pixi.js";
import type { Graphics } from "pixi.js";
import { OFFICE_GEOMETRY } from "./officeGeometry";

export type OfficeFloorMaterial = "carpet" | "wood" | "asphalt";

/** Renderer-owned repeating materials: work stays independent of floor area. */
export class OfficeFloorTextures {
  viewport?: { y: number; height: number };
  private textures = new Map<string, Texture>();

  draw(
    graphics: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    first: number,
    second: number,
    material?: OfficeFloorMaterial,
  ) {
    if (width <= 0 || height <= 0) return;
    if (material) {
      this.drawMaterial(graphics, x, y, width, height, first, second, material);
      return;
    }
    const tile = OFFICE_GEOMETRY.tile;
    // Fractional tile edges have per-cell MSAA coverage in the vector baseline.
    // Retain those paths rather than changing seams when a room is centred.
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      const firstY = this.viewport
        ? Math.max(0, Math.floor((this.viewport.y - y) / tile) * tile)
        : 0;
      const lastY = this.viewport
        ? Math.min(height, this.viewport.y + this.viewport.height - y + tile)
        : height;
      for (let offsetY = firstY; offsetY < lastY; offsetY += tile) {
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

  private drawMaterial(
    graphics: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    first: number,
    second: number,
    material: OfficeFloorMaterial,
  ) {
    const key = `${material}:${first}:${second}`;
    let texture = this.textures.get(key);
    if (!texture) {
      const canvas = document.createElement("canvas");
      canvas.width = material === "wood" ? 128 : 48;
      canvas.height = material === "wood" ? 32 : 48;
      const context = canvas.getContext("2d")!;
      context.fillStyle = `#${first.toString(16).padStart(6, "0")}`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `#${second.toString(16).padStart(6, "0")}`;
      if (material === "carpet") {
        for (let row = 0; row < 6; row++)
          for (let column = 0; column < 6; column++)
            context.fillRect(column * 8 + (row % 2) * 3, row * 8 + 3, 2, 1);
        context.globalAlpha = 0.45;
        context.fillRect(0, 0, 48, 1);
        context.fillRect(0, 0, 1, 48);
      } else if (material === "wood") {
        context.fillRect(0, 1, 128, 14);
        context.globalAlpha = 0.45;
        for (const [px, py, length] of [
          [8, 5, 43],
          [68, 10, 47],
          [27, 23, 39],
          [94, 27, 21],
        ])
          context.fillRect(px!, py!, length!, 1);
        context.fillStyle = "#171c23";
        context.globalAlpha = 0.65;
        context.fillRect(0, 0, 128, 1);
        context.fillRect(0, 16, 128, 1);
        context.fillRect(0, 0, 1, 16);
        context.fillRect(64, 16, 1, 16);
      } else {
        for (let row = 0; row < 6; row++)
          for (let column = 0; column < 6; column++)
            context.fillRect(
              (column * 9 + row * 5) % 48,
              (row * 9 + column * 3) % 48,
              1,
              1,
            );
      }
      texture = new Texture({
        source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
      });
      this.textures.set(key, texture);
    }
    const pattern = new FillPattern(texture, "repeat");
    pattern.setTransform(new Matrix().translate(x, y));
    // Exact bounds avoid complete checker tiles protruding into adjacent corridors.
    graphics.rect(x, y, width, height).fill(pattern);
  }

  destroy() {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }
}
