import { Container, Graphics } from "pixi.js";
import type { OfficeLayout, OfficeRect } from "./officeGeometry";
import { OfficeFloorTextures } from "./officeFloorTextures";
import { officePackedRoomCorridors } from "./officeRoomPacking";
import {
  drawHorizontalRoad,
  drawVerticalRoad,
} from "./officeCommonAreaDrawing";
import { officeIntersects } from "./officeVirtualization";

/** Cutaway buildings share the rooms' pixel furniture and wooden sign palette. */
export function drawOfficeBuildings(
  stage: Container,
  layout: OfficeLayout,
  floors: OfficeFloorTextures,
  viewport?: OfficeRect,
) {
  const walls = new Graphics();
  for (const building of layout.buildings ?? []) {
    const rect = building.rect;
    if (!officeIntersects(rect, viewport)) continue;
    const { x, y, width, height } = rect;
    const brick = building.stale ? 0x514952 : 0x664b50;
    const edge = building.stale ? 0x766977 : 0x9b7c70;
    walls.rect(x + 4, y + 8, width - 4, height - 4).fill(0x090b12);
    walls.rect(x, y + 8, width, height - 8).fill(0x302a36);
    floors.draw(
      walls,
      x + 8,
      y + 84,
      width - 16,
      height - 92,
      0x29323d,
      0x303a46,
      "carpet",
    );
    const paths = officePackedRoomCorridors(
      rect,
      layout.officeWidth - 12,
      20,
      20,
    );
    drawHorizontalRoad(
      walls,
      paths.horizontal.x,
      paths.horizontal.y,
      paths.horizontal.width,
      paths.horizontal.height,
    );
    if (paths.vertical.width > 0)
      drawVerticalRoad(
        walls,
        paths.vertical.x,
        paths.vertical.y,
        paths.vertical.width,
        paths.vertical.height,
        viewport,
      );

    // Only visible courses are prepared, even on a building thousands of rows tall.
    const firstCourse = Math.max(0, Math.floor(((viewport?.y ?? y) - y) / 10));
    const lastY = Math.min(
      y + height - 8,
      viewport ? viewport.y + viewport.height : y + height,
    );
    for (let row = firstCourse; y + row * 10 < lastY; row++) {
      const by = y + row * 10;
      walls.rect(x + 1, by + 1, 7, 8).fill(brick);
      walls.rect(x + width - 8, by + 1, 7, 8).fill(brick);
      walls.rect(x + 1, by + 1, 1, 8).fill(edge);
      walls.rect(x + width - 2, by + 1, 1, 8).fill(edge);
    }

    const facade = { x: x + 8, y: y + 10, width: width - 16, height: 72 };
    if (officeIntersects(facade, viewport)) {
      walls
        .rect(facade.x, facade.y, facade.width, facade.height)
        .fill(0x382f3a);
      for (let row = 0; row < 7; row++) {
        for (let bx = x + 8 - (row % 2) * 14; bx < x + width - 8; bx += 28) {
          const left = Math.max(x + 8, bx);
          const right = Math.min(x + width - 8, bx + 26);
          walls.rect(left, y + 11 + row * 10, right - left, 8).fill(brick);
          walls.rect(left, y + 11 + row * 10, right - left, 1).fill(edge);
        }
      }
      walls.rect(x + 8, y + 78, width - 16, 4).fill(edge);
      walls.rect(x + 8, y + 82, width - 16, 2).fill(0x17141f);
    }

    // Stepped roof cap and stone foundation keep the silhouette architectural.
    walls.rect(x + 4, y, width - 8, 4).fill(0x8c8c98);
    walls.rect(x + 2, y + 4, width - 4, 4).fill(0x535768);
    walls.rect(x, y + 8, width, 4).fill(0x292d40);
    walls.rect(x, y + height - 8, width, 3).fill(edge);
    walls.rect(x, y + height - 5, width, 5).fill(0x393441);

    const sign = building.headerRect;
    if (officeIntersects(sign, viewport)) {
      walls
        .rect(sign.x + 3, sign.y + 4, sign.width, sign.height)
        .fill(0x211b20);
      walls.rect(sign.x, sign.y, sign.width, sign.height).fill(0x765432);
      walls
        .rect(sign.x + 2, sign.y + 2, sign.width - 4, sign.height - 4)
        .fill(0xb28a51);
      walls
        .rect(sign.x + 4, sign.y + 4, sign.width - 8, sign.height - 8)
        .fill(0x202d29);
      walls.rect(sign.x + 5, sign.y + 5, sign.width - 10, 1).fill(0x59604b);
      for (const boltX of [sign.x + 5, sign.x + sign.width - 7]) {
        for (const boltY of [sign.y + 5, sign.y + sign.height - 7]) {
          walls.rect(boltX, boltY, 2, 2).fill(0xe1c387);
        }
      }
    }
  }
  stage.addChild(walls);
}
