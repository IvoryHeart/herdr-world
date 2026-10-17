/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { Container, Graphics, Texture } from "pixi.js";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { agentBarSlot, OFFICE_GEOMETRY } from "./officeGeometry";
import type {
  OfficeCeoBlockLayout,
  OfficeLayout,
  OfficeRoomRect,
} from "./officeGeometry";
import { OfficeFloorTextures } from "./officeFloorTextures";
import { type AnimatedItem } from "./officeRendererTypes";
import {
  STATUS_CUES,
  label,
  shortLabel,
  blendColor,
} from "./officeDrawingShared";
import { makeInteractive } from "./officeInteraction";
import { drawCharacter, addSign } from "./officeDrawingPrimitives";

export function drawBackground(stage: Container, layout: OfficeLayout) {
  const background = new Graphics();
  background
    .roundRect(0, 0, layout.officeWidth, layout.totalHeight, 6)
    .fill(0x0e0e1c);
  for (let band = 0; band < 14; band += 1) {
    background
      .rect(
        2,
        2 + (layout.totalHeight - 4) * (band / 14),
        layout.officeWidth - 4,
        layout.totalHeight / 14 + 1,
      )
      .fill({ color: blendColor(0x15152a, 0x090914, band / 13), alpha: 0.9 });
  }
  background
    .roundRect(2, 2, layout.officeWidth - 4, layout.totalHeight - 4, 5)
    .stroke({ width: 2, color: 0x2a2a48, alpha: 0.8 });
  stage.addChild(background);
}

export function drawVerticalRoad(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const road = new Graphics();
  road.rect(x, y, width, height).fill(0x252537);
  road.rect(x, y, 1, height).fill({ color: 0x6c6990, alpha: 0.35 });
  road.rect(x + width - 1, y, 1, height).fill({ color: 0x6c6990, alpha: 0.35 });
  for (let markerY = y + 14; markerY < y + height - 8; markerY += 18) {
    road
      .rect(x + width / 2, markerY, 1, 6)
      .fill({ color: 0x77749a, alpha: 0.38 });
  }
  parent.addChild(road);
}

export function drawHallways(stage: Container, layout: OfficeLayout) {
  const hall = new Graphics();
  const y = layout.ceoBandHeight;
  hall
    .rect(4, y, layout.officeWidth - 8, OFFICE_GEOMETRY.hallwayHeight)
    .fill(0x252537);
  hall
    .rect(4, y, layout.officeWidth - 8, 1)
    .fill({ color: 0x6c6990, alpha: 0.35 });
  for (let x = 20; x < layout.officeWidth - 20; x += 18) {
    hall.rect(x, y + 16, 7, 1).fill({ color: 0x77749a, alpha: 0.38 });
  }
  stage.addChild(hall);
}

export function drawRoomRoads(
  stage: Container,
  layout: OfficeLayout,
  visibleRooms: readonly OfficeRoomRect[],
) {
  const road = new Graphics();
  const rows = new Map<number, OfficeRoomRect[]>();
  visibleRooms.forEach((room) => {
    const row = rows.get(room.row) ?? [];
    row.push(room);
    rows.set(room.row, row);
  });
  const sortedRows = [...rows.values()]
    .map((row) => row.sort((left, right) => left.x - right.x))
    .sort((left, right) => left[0].y - right[0].y);

  sortedRows.forEach((row) => {
    row.slice(0, -1).forEach((room, index) => {
      const next = row[index + 1];
      const gap = next.x - (room.x + room.width);
      if (gap > 0) {
        drawVerticalRoad(
          road,
          room.x + room.width,
          room.y,
          gap,
          Math.min(room.height, next.height),
        );
      }
    });
  });
  sortedRows.slice(0, -1).forEach((row, index) => {
    const nextRow = sortedRows[index + 1];
    const rowBottom = Math.max(...row.map(({ y, height }) => y + height));
    const nextRowTop = Math.min(...nextRow.map(({ y }) => y));
    if (nextRowTop > rowBottom) {
      drawHorizontalRoad(
        road,
        4,
        rowBottom,
        layout.officeWidth - 8,
        nextRowTop - rowBottom,
      );
    }
  });
  stage.addChild(road);
}

function drawHorizontalRoad(
  parent: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0) {
    return;
  }
  parent.rect(x, y, width, height).fill(0x252537);
  parent.rect(x, y, width, 1).fill({ color: 0x6c6990, alpha: 0.35 });
  parent
    .rect(x, y + height - 1, width, 1)
    .fill({ color: 0x6c6990, alpha: 0.35 });
  for (let markerX = x + 14; markerX < x + width - 8; markerX += 18) {
    parent
      .rect(markerX, y + height / 2, 7, 1)
      .fill({ color: 0x77749a, alpha: 0.38 });
  }
}

export function drawAgentBar(
  parent: Container,
  blocks: OfficeCeoBlockLayout,
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
  floors: OfficeFloorTextures,
) {
  const x = blocks.agentBarX;
  const y = 4;
  const width = blocks.agentBarWidth;
  const height = blocks.agentBarHeight;
  const room = new Container();
  const floor = new Graphics();
  floors.draw(floor, x, y, width, height, 0x17140f, 0x11100d);
  floor
    .roundRect(x, y, width, height, 4)
    .stroke({ width: 2, color: 0xb59048, alpha: 0.72 });
  room.addChild(floor);
  addSign(
    room,
    x + width / 2 - 58,
    y + 8,
    "AGENT BAR",
    0xa17d37,
    116,
    undefined,
    undefined,
    undefined,
    10,
  );

  const boardX = x + 10;
  const boardY = y + 42;
  const boardWidth = Math.min(76, width * 0.25);
  const boardHeight = height - 86;
  const firstSlot = agentBarSlot(blocks, 0);
  const barX = boardX + boardWidth + 10;
  const barWidth = Math.max(0, x + width - 10 - barX);
  const counterY = y + height - OFFICE_GEOMETRY.agentBarCounterBottomClearance;
  const capacity = firstSlot.capacity;
  const visibleBarAgents = projection.barAgents.slice(0, capacity);
  drawPartyBoard(
    room,
    boardX,
    boardY,
    boardWidth,
    boardHeight,
    visibleBarAgents.length,
  );
  visibleBarAgents.forEach((agent, index) => {
    const slot = agentBarSlot(blocks, index);
    const px = slot.x;
    const rowY = slot.rowY;
    const cue = agent.stale
      ? { label: "STALE", color: 0x79869a }
      : STATUS_CUES[agent.semanticStatus];
    const name = label(shortLabel(agent.displayLabel, 10), {
      size: 8,
      color: 0xf0ece5,
      anchor: 0.5,
    });
    name.position.set(px, rowY + 1);
    makeInteractive(name, agent.key, onSelect, onActivateAgent);
    room.addChild(name);
    const state = label(cue.label, { size: 6, color: cue.color, anchor: 0.5 });
    state.position.set(px, rowY + 12);
    makeInteractive(state, agent.key, onSelect, onActivateAgent);
    room.addChild(state);
    const characterFeetY = slot.characterFeetY;
    const character = drawCharacter(
      room,
      textures[agent.characterIndex] ?? Texture.EMPTY,
      px,
      characterFeetY,
      false,
      agent.stale,
      animated,
      agent.key,
      onSelect,
      selectedKey,
      onActivateAgent,
    );
    character.alpha = agent.stale ? 0.56 : 1;
  });
  drawBarCounter(
    room,
    barX,
    counterY,
    barWidth,
    visibleBarAgents.map((_, index) => agentBarSlot(blocks, index).x),
  );
  drawBarBottleRow(room, barX, y + height, barWidth);
  const overflowCount =
    projection.coverage.omittedBarAgents +
    Math.max(0, projection.barAgents.length - capacity);
  if (overflowCount > 0) {
    const overflow = label(`+${overflowCount} more`, {
      size: 8,
      color: 0xe5cf98,
      anchor: { x: 1, y: 0 },
    });
    overflow.position.set(x + width - 10, y + 12);
    room.addChild(overflow);
  }
  parent.addChild(room);
}

function drawPartyBoard(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number,
  idleCount: number,
) {
  const board = new Graphics();
  board
    .roundRect(x + 3, y + 4, width, height, 4)
    .fill({ color: 0x000000, alpha: 0.28 });
  board.roundRect(x, y, width, height, 4).fill(0x553b25);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 2).fill(0x17251f);
  board
    .roundRect(x + 4, y + 4, width - 8, height - 8, 2)
    .stroke({ width: 1, color: 0x9b7542, alpha: 0.72 });
  parent.addChild(board);
  const heading = label("PARTY", { size: 11, color: 0xf2d78f, anchor: 0.5 });
  heading.position.set(x + width / 2, y + 17);
  parent.addChild(heading);
  const value = label(String(idleCount), {
    size: 26,
    color: 0xf1e9bd,
    anchor: 0.5,
  });
  value.position.set(x + width / 2, y + height / 2 - 4);
  parent.addChild(value);
  drawPartyDecorations(parent, x, y, width, height);
}

function drawPartyDecorations(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const decorations = new Graphics();
  const confetti = [
    [10, 25, 0xe29b66],
    [width - 14, 23, 0x8fb9d8],
    [16, 58, 0x9fceac],
    [width - 20, 68, 0xdca4c7],
    [10, height - 32, 0xf3c07e],
    [width - 14, height - 30, 0xe29b66],
  ] as const;
  confetti.forEach(([offsetX, offsetY, color], index) => {
    if (index % 2 === 0) {
      decorations.rect(x + offsetX, y + offsetY, 3, 7).fill(color);
    } else {
      decorations.circle(x + offsetX, y + offsetY, 2.5).fill(color);
    }
  });
  const glassX = x + width / 2 - 4;
  const glassY = y + height - 30;
  decorations
    .roundRect(glassX - 6, glassY, 12, 9, 3)
    .stroke({ width: 1.5, color: 0xf1d19a, alpha: 0.9 });
  decorations.rect(glassX - 1, glassY + 9, 2, 9).fill(0xf1d19a);
  decorations.rect(glassX - 7, glassY + 18, 14, 2).fill(0xf1d19a);
  parent.addChild(decorations);
}

function drawBarBottleRow(
  parent: Container,
  x: number,
  roomBottom: number,
  width: number,
) {
  const shelf = new Graphics();
  const bottleY = roomBottom - 30;
  const shelfY = bottleY + 18;
  const shelfWidth = Math.max(0, width - 16);
  shelf
    .rect(x + 8, shelfY, shelfWidth, 3)
    .fill({ color: 0x5b3c2b, alpha: 0.72 });
  shelf
    .rect(x + 8, shelfY + 3, shelfWidth, 1)
    .fill({ color: 0xd0a878, alpha: 0.36 });
  parent.addChild(shelf);
  const drinks = new Graphics();
  const count = Math.max(3, Math.min(12, Math.floor(width / 42)));
  for (let index = 0; index < count; index += 1) {
    const drinkX =
      x + 14 + ((shelfWidth - 12) * index) / Math.max(1, count - 1);
    const drinkY = bottleY;
    const liquid = [0xd36e57, 0x7ab9c4, 0xd6a24e, 0xb884d6][index % 4];
    drinks
      .roundRect(drinkX - 4, drinkY, 8, 13, 2)
      .fill({ color: liquid, alpha: 0.86 })
      .stroke({ width: 1, color: 0xf1d19a, alpha: 0.78 });
    drinks.rect(drinkX - 2, drinkY - 4, 4, 4).fill(0xf1d19a);
  }
  parent.addChild(drinks);
}

function drawBarCounter(
  parent: Container,
  x: number,
  y: number,
  width: number,
  glassXs: readonly number[],
) {
  const counter = new Graphics();
  counter
    .roundRect(x + 3, y + 6, width, 34, 8)
    .fill({ color: 0x000000, alpha: 0.28 });
  counter.roundRect(x, y, width, 32, 7).fill(0x4c3122);
  counter.roundRect(x + 4, y + 4, width - 8, 9, 4).fill(0x8b5b35);
  counter
    .rect(x + 8, y + 7, width - 16, 2)
    .fill({ color: 0xd0a878, alpha: 0.54 });
  counter.roundRect(x + 8, y + 16, width - 16, 12, 4).fill(0x38231d);
  for (let panel = x + 24; panel < x + width - 18; panel += 52) {
    counter.rect(panel, y + 19, 1, 7).fill({ color: 0xb07945, alpha: 0.4 });
  }
  for (let tap = x + 24; tap < x + width - 20; tap += 74) {
    counter.circle(tap, y + 10, 3).fill(0xd0a878);
    counter.rect(tap - 1, y + 9, 2, 7).fill(0x5b3c2b);
  }
  parent.addChild(counter);
  const drinks = new Graphics();
  glassXs.forEach((drinkX, index) => {
    const drinkY = y - 9;
    const liquid = [0xd36e57, 0x7ab9c4, 0xd6a24e, 0xb884d6][index % 4];
    drinks
      .roundRect(drinkX - 5, drinkY, 10, 8, 2)
      .fill({ color: liquid, alpha: 0.9 })
      .stroke({ width: 1, color: 0xf1d19a, alpha: 0.9 });
    drinks.rect(drinkX - 1, drinkY + 8, 2, 7).fill(0xf1d19a);
    drinks.rect(drinkX - 6, drinkY + 15, 12, 2).fill(0xf1d19a);
  });
  parent.addChild(drinks);
}
