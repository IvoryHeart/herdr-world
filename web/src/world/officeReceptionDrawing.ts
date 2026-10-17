/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { Container, Graphics, Texture } from "pixi.js";
import type {
  HerdrOfficeProjection,
  OfficeReception,
} from "./herdrOfficeProjection";
import {
  OFFICE_GEOMETRY,
  receptionAgentAnchor,
  receptionTableRect,
} from "./officeGeometry";
import type { OfficeLayout, OfficeReceptionRect } from "./officeGeometry";
import { OfficeFloorTextures } from "./officeFloorTextures";
import type { OfficeObservability } from "./officeObservability";
import {
  formatOfficeCost,
  formatOfficeModelName,
  officeModelUsageTotal,
  formatOfficeUsage,
} from "./officeObservability";
import { type AnimatedItem } from "./officeRendererTypes";
import { label, shortLabel, hostColor } from "./officeDrawingShared";
import { makeInteractive } from "./officeInteraction";
import {
  drawCharacter,
  addCharacterSprite,
  drawChair,
  drawChairArms,
  addSign,
  drawReceptionStatusBadge,
} from "./officeDrawingPrimitives";
import { drawRoomOverflowMarker } from "./officeRoomDrawing";
import { drawVerticalRoad, drawAgentBar } from "./officeCommonAreaDrawing";

export function drawCeoReception(
  stage: Container,
  layout: OfficeLayout,
  projection: HerdrOfficeProjection,
  observability: OfficeObservability,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
  visibleReceptions: readonly {
    reception: HerdrOfficeProjection["receptions"][number];
    index: number;
    rect: OfficeReceptionRect;
  }[],
  floors: OfficeFloorTextures,
) {
  const band = new Container();
  if (layout.fallbackMessage) {
    if (layout.ceoOverflowMarkerRect) {
      drawRoomOverflowMarker(band, layout.ceoOverflowMarkerRect, 0xf0c878);
    }
    stage.addChild(band);
    return;
  }
  const ceoBlocks = layout.ceoBlocks;
  const ceoRoomRight = layout.ceoRect.x + layout.ceoRect.width;
  const floor = new Graphics();
  floors.draw(
    floor,
    4,
    4,
    ceoRoomRight - 4,
    layout.ceoRect.height,
    0x131328,
    0x0e0e1d,
  );
  floor
    .roundRect(4, 4, ceoRoomRight - 4, layout.ceoRect.height, 4)
    .stroke({ width: 2, color: 0x8d7135, alpha: 0.8 });
  band.addChild(floor);
  drawVerticalRoad(
    band,
    ceoRoomRight,
    4,
    Math.max(0, layout.agentBarRect.x - ceoRoomRight),
    layout.ceoRect.height,
  );
  const ceoContent = new Container();
  ceoContent.position.x = ceoBlocks.ceoOriginX;
  ceoContent.scale.x = ceoBlocks.ceoScale;
  addSign(
    ceoContent,
    ceoBlocks.ceoContentWidth / 2 - 88,
    8,
    "CEO OFFICE",
    0x76571c,
    176,
    undefined,
    undefined,
    undefined,
    13,
  );
  drawCeo(ceoContent, textures, ceoBlocks.localCeoX);
  drawOtelCostBoard(ceoContent, observability, ceoBlocks.localOtelBoardX);
  drawLiveStateBlackboard(ceoContent, projection, ceoBlocks.localBoardX);
  visibleReceptions.forEach(({ reception, index }) => {
    const rect = ceoBlocks.localReceptions[index];
    if (!rect) return;
    drawReceptionDesk(
      ceoContent,
      reception,
      projection,
      rect,
      selectedKey,
      textures,
      animated,
      onSelect,
      onActivateAgent,
    );
  });
  if (projection.coverage.omittedReceptionDesks > 0) {
    const overflow = label(
      `+${projection.coverage.omittedReceptionDesks} host desks in roster`,
      {
        size: 10,
        color: 0xd7c394,
        anchor: { x: 1, y: 0 },
      },
    );
    overflow.position.set(ceoBlocks.ceoContentWidth - 18, 13);
    ceoContent.addChild(overflow);
  }
  band.addChild(ceoContent);
  if (layout.ceoOverflowMarkerRect) {
    drawRoomOverflowMarker(band, layout.ceoOverflowMarkerRect, 0xf0c878);
  }
  drawAgentBar(
    band,
    ceoBlocks,
    projection,
    selectedKey,
    textures,
    animated,
    onSelect,
    onActivateAgent,
    floors,
  );
  stage.addChild(band);
}

function drawCeo(
  parent: Container,
  textures: readonly Texture[],
  deskX: number,
) {
  const deskWidth = OFFICE_GEOMETRY.ceoDeskWidth;
  const deskCenterX = deskX + deskWidth / 2;
  const title = label("YOU · CEO", { size: 11, color: 0xf6e3b2, anchor: 0.5 });
  title.position.set(deskCenterX, 48);
  parent.addChild(title);
  drawChair(parent, deskCenterX, 136, 0x8c6e35);
  const viewer = new Container();
  viewer.position.set(deskCenterX, 148);
  addCharacterSprite(viewer, textures[0] ?? Texture.EMPTY);
  parent.addChild(viewer);
  drawChairArms(parent, deskCenterX, 136, 0x8c6e35);
  const desk = new Graphics();
  desk.roundRect(deskX, 130, deskWidth, 44, 5).fill(0x493728);
  desk.roundRect(deskX + 4, 134, deskWidth - 8, 36, 4).fill(0x705234);
  desk.roundRect(deskX + 50, 138, 60, 25, 3).fill(0x182031);
  desk.roundRect(deskX + 57, 144, 46, 13, 2).fill(0x356c9e);
  desk
    .rect(deskX + 4, 168, deskWidth - 8, 2)
    .fill({ color: 0xc39a55, alpha: 0.72 });
  parent.addChild(desk);
}

function drawLiveStateBlackboard(
  parent: Container,
  projection: HerdrOfficeProjection,
  x: number,
) {
  const {
    ceoBoardY: y,
    ceoBoardWidth: width,
    ceoBoardHeight: height,
  } = OFFICE_GEOMETRY;
  const board = new Graphics();
  board
    .roundRect(x + 4, y + 5, width, height, 5)
    .fill({ color: 0x000000, alpha: 0.34 });
  board.roundRect(x, y, width, height, 5).fill(0x553b25);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 3).fill(0x17251f);
  board
    .roundRect(x + 4, y + 4, width - 8, height - 8, 3)
    .stroke({ width: 1, color: 0x9b7542, alpha: 0.78 });
  board
    .rect(x + 10, y + 18, width - 20, 1)
    .fill({ color: 0xd8e8c8, alpha: 0.2 });
  board
    .rect(x + 8, y + height - 10, width - 16, 2)
    .fill({ color: 0x8f6e3c, alpha: 0.58 });
  parent.addChild(board);

  const heading = label("WORKFORCE", {
    size: 12,
    color: 0xe2f1d1,
    anchor: 0.5,
  });
  heading.position.set(x + width / 2, y + 12);
  parent.addChild(heading);

  const metrics: Array<[string, number | string]> = [
    ["HOSTS", projection.coverage.observedHosts],
    ["SPACES", projection.coverage.observedWorkspaces],
    ["AGENTS", projection.coverage.observedAgents],
    ["WORKING", projection.coverage.status.working],
    ["INPUT", projection.coverage.status.blocked],
    ["STALE", projection.coverage.staleHosts],
  ];
  const columnWidth = (width - 20) / 3;
  metrics.forEach(([metric, value], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const centerX = x + 10 + columnWidth * (column + 0.5);
    const centerY = y + 52 + row * 44;
    const valueLabel = label(String(value), {
      size: 20,
      color:
        metric === "STALE" && typeof value === "number" && value > 0
          ? 0xffb0ba
          : 0xf1e9bd,
      anchor: 0.5,
    });
    valueLabel.position.set(centerX, centerY);
    parent.addChild(valueLabel);
    const metricLabel = label(metric, {
      size: 11,
      color: 0xa9c8a4,
      anchor: 0.5,
    });
    metricLabel.position.set(centerX, centerY + 13);
    parent.addChild(metricLabel);
  });
}

function drawOtelCostBoard(
  parent: Container,
  observability: OfficeObservability,
  x: number,
) {
  const {
    ceoBoardY: y,
    ceoOtelBoardWidth: width,
    ceoBoardHeight: height,
  } = OFFICE_GEOMETRY;
  const board = new Graphics();
  board
    .roundRect(x + 4, y + 5, width, height, 5)
    .fill({ color: 0x000000, alpha: 0.34 });
  board.roundRect(x, y, width, height, 5).fill(0x553b25);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 3).fill(0x17251f);
  board
    .roundRect(x + 4, y + 4, width - 8, height - 8, 3)
    .stroke({ width: 1, color: 0x9b7542, alpha: 0.78 });
  board
    .rect(x + 10, y + 34, width - 20, 1)
    .fill({ color: 0xd8e8c8, alpha: 0.2 });
  board
    .rect(x + 8, y + height - 10, width - 16, 2)
    .fill({ color: 0x8f6e3c, alpha: 0.58 });
  parent.addChild(board);

  const heading = label("ECONOMY", {
    size: 12,
    color: 0xe2f1d1,
    anchor: 0.5,
  });
  heading.position.set(x + width / 2, y + 12);
  parent.addChild(heading);

  const modelHeader = label("MODEL", {
    size: 11,
    color: 0xa9c8a4,
    anchor: { x: 0, y: 0.5 },
    weight: "700",
  });
  modelHeader.position.set(x + 12, y + 26);
  parent.addChild(modelHeader);
  const tokenColumnX = x + 100;
  const coinIcon = new Graphics();
  coinIcon
    .circle(tokenColumnX - 4, y + 25, 5)
    .fill({ color: 0xd4b66c, alpha: 0.62 });
  coinIcon
    .circle(tokenColumnX + 3, y + 24, 5)
    .fill({ color: 0xd4b66c, alpha: 0.82 });
  coinIcon.circle(tokenColumnX, y + 28, 5).fill(0xf1e9bd);
  coinIcon
    .circle(tokenColumnX, y + 28, 2)
    .fill({ color: 0x8a6b3d, alpha: 0.8 });
  parent.addChild(coinIcon);
  const costHeader = label("$$$", {
    size: 12,
    color: 0xa9c8a4,
    anchor: { x: 1, y: 0.5 },
    weight: "700",
  });
  costHeader.position.set(x + width - 12, y + 26);
  parent.addChild(costHeader);

  if (
    observability.health !== "available" ||
    observability.models.length === 0
  ) {
    const status = label(
      observability.health === "degraded" ? "DEGRADED" : "NO DATA",
      {
        size: 14,
        color: observability.health === "degraded" ? 0xffb0ba : 0xd7c394,
        anchor: 0.5,
      },
    );
    status.position.set(x + width / 2, y + 78);
    parent.addChild(status);
    return;
  }

  observability.models.slice(0, 4).forEach((model, index) => {
    const rowY = y + 48 + index * 22;
    const modelLabel = label(formatOfficeModelName(model.model), {
      size: 11,
      color: 0xf0ece5,
      anchor: { x: 0, y: 0.5 },
    });
    modelLabel.position.set(x + 12, rowY);
    parent.addChild(modelLabel);
    const tokenLabel = label(
      formatOfficeUsage(officeModelUsageTotal(model.usage)),
      {
        size: 12,
        color: 0xf1e9bd,
        anchor: 0.5,
      },
    );
    tokenLabel.position.set(tokenColumnX, rowY);
    parent.addChild(tokenLabel);
    const costLabel = label(formatOfficeCost(model.costUsd, model.costKind), {
      size: 12,
      color: 0xf1e9bd,
      anchor: { x: 1, y: 0.5 },
    });
    costLabel.position.set(x + width - 12, rowY);
    parent.addChild(costLabel);
  });

  board
    .rect(x + 10, y + height - 31, width - 20, 1)
    .fill({ color: 0xd8e8c8, alpha: 0.2 });
  const totalLabel = label("TOTAL", {
    size: 11,
    color: 0xa9c8a4,
    anchor: { x: 0, y: 0.5 },
    weight: "700",
  });
  totalLabel.position.set(x + 12, y + height - 20);
  parent.addChild(totalLabel);
  const totalTokens = label(formatOfficeUsage(observability.totalUsage), {
    size: 12,
    color: 0xf1e9bd,
    anchor: 0.5,
    weight: "700",
  });
  totalTokens.position.set(tokenColumnX, y + height - 20);
  parent.addChild(totalTokens);
  const totalCostKind = observability.models.some(
    ({ costKind }) => costKind !== null && costKind !== "reported",
  )
    ? ("estimated" as const)
    : null;
  const totalCost = label(
    formatOfficeCost(observability.totalCostUsd, totalCostKind),
    {
      size: 12,
      color: 0xf1e9bd,
      anchor: { x: 1, y: 0.5 },
      weight: "700",
    },
  );
  totalCost.position.set(x + width - 12, y + height - 20);
  parent.addChild(totalCost);
}

function drawReceptionDesk(
  parent: Container,
  reception: OfficeReception,
  projection: HerdrOfficeProjection,
  rect: OfficeReceptionRect,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const host = projection.hosts.find(({ key }) => key === reception.hostKey);
  if (!host) {
    return;
  }
  const accent = hostColor(host);
  const centerX = rect.x + rect.width / 2;
  const zone = new Graphics();
  zone.rect(rect.x, rect.y, rect.width, rect.height).fill({
    color: selectedKey === host.key ? accent : 0x000000,
    alpha: selectedKey === host.key ? 0.08 : 0.001,
  });
  makeInteractive(zone, host.key, onSelect);
  parent.addChild(zone);
  if (rect.index > 0) {
    const separator = new Graphics();
    separator
      .rect(rect.x - rect.gapBefore / 2, rect.y + 8, 1, rect.height - 20)
      .fill({ color: 0x77749a, alpha: 0.22 });
    parent.addChild(separator);
  }
  const agents = reception.waitingAgents;
  const table = receptionTableRect(rect);
  const receptionChairs = Array.from({ length: 4 }, (_, index) => {
    const anchor = receptionAgentAnchor(rect, index);
    const chairY =
      anchor.characterFeetY - OFFICE_GEOMETRY.characterHeight * 0.18;
    drawChair(parent, anchor.x, chairY, accent);
    return { anchor, chairY };
  });
  Array.from(
    { length: 4 },
    (_, index) => table.x + table.width * ((index + 0.5) / 4),
  ).forEach((x) => {
    const chairY = table.y + table.height + 10;
    drawChair(parent, x, chairY, accent);
    drawChairArms(parent, x, chairY, accent);
  });
  agents.slice(0, 4).forEach((agent, index) => {
    const anchor = receptionAgentAnchor(rect, index);
    const chairY = receptionChairs[index]?.chairY;
    const name = label(shortLabel(agent.displayLabel, 12), {
      size: 8,
      color: 0xf2edf1,
      anchor: 0.5,
    });
    name.position.set(anchor.x, anchor.nameY);
    makeInteractive(name, agent.key, onSelect, onActivateAgent);
    parent.addChild(name);
    const character = drawCharacter(
      parent,
      textures[agent.characterIndex] ?? Texture.EMPTY,
      anchor.x,
      anchor.characterFeetY,
      false,
      agent.stale,
      animated,
      agent.key,
      onSelect,
      selectedKey,
      onActivateAgent,
    );
    character.alpha = agent.stale ? 0.56 : 1;
    if (chairY !== undefined) drawChairArms(parent, anchor.x, chairY, accent);
    drawReceptionStatusBadge(
      parent,
      agent,
      anchor.x + 15,
      anchor.nameY + 17,
      onSelect,
      onActivateAgent,
    );
  });
  receptionChairs.slice(agents.length).forEach(({ anchor, chairY }) => {
    drawChairArms(parent, anchor.x, chairY, accent);
  });

  const desk = new Graphics();
  desk
    .ellipse(
      table.x + table.width / 2,
      table.y + table.height + 3,
      Math.max(1, table.width * 0.38),
      5,
    )
    .fill({ color: 0x000000, alpha: 0.24 });
  desk
    .roundRect(table.x, table.y, table.width, table.height, 16)
    .fill(0x4a3526);
  desk
    .roundRect(table.x + 4, table.y + 4, table.width - 8, table.height - 8, 13)
    .fill(0x765437);
  desk
    .roundRect(
      table.x + table.width * 0.32,
      table.y + 8,
      table.width * 0.36,
      7,
      3,
    )
    .fill(0x2d2b32);
  desk
    .roundRect(
      table.x + 6,
      table.y + 6,
      table.width - 12,
      table.height - 12,
      11,
    )
    .stroke({ width: 1, color: accent, alpha: 0.68 });
  makeInteractive(desk, host.key, onSelect);
  parent.addChild(desk);
  const deskLabel = label(shortLabel(host.displayLabel, 20), {
    size: 10,
    color: 0xf4e6c0,
    anchor: 0.5,
  });
  deskLabel.position.set(centerX, table.y + table.height / 2);
  parent.addChild(deskLabel);
  if (reception.overflowCount > 0) {
    const overflow = label(`+${reception.overflowCount} waiting in roster`, {
      size: 8,
      color: 0xf0c878,
      anchor: 0.5,
    });
    overflow.position.set(centerX, table.y + table.height - 7);
    parent.addChild(overflow);
  }
  agents.slice(4).forEach((agent, index) => {
    const anchor = receptionAgentAnchor(rect, index + 4);
    const character = drawCharacter(
      parent,
      textures[agent.characterIndex] ?? Texture.EMPTY,
      anchor.x,
      anchor.characterFeetY,
      false,
      agent.stale,
      animated,
      agent.key,
      onSelect,
      selectedKey,
      onActivateAgent,
    );
    character.scale.set(0.5);
    character.alpha = agent.stale ? 0.56 : 1;
    drawReceptionStatusBadge(
      parent,
      agent,
      anchor.x + 12,
      anchor.nameY + 12,
      onSelect,
      onActivateAgent,
    );
  });
}
