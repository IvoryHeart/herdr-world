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
  OfficeAgent,
  OfficeDesk,
  OfficeHost,
  OfficeRoom,
} from "./herdrOfficeProjection";
import {
  deskAnchor,
  paneDeviceAnchor,
  OFFICE_GEOMETRY,
  standingAnchor,
} from "./officeGeometry";
import type { OfficeRoomRect } from "./officeGeometry";
import { OfficeFloorTextures } from "./officeFloorTextures";
import type { OfficeCreationActionState } from "./officeRoomActions";
import { officeStandingAgentAnchors } from "./officeSemanticTargets";
import { type AnimatedItem } from "./officeRendererTypes";
import {
  OFFICE_HEADING_TEXT_SIZE,
  THEMES,
  STATUS_CUES,
  label,
  shortLabel,
  blendColor,
} from "./officeDrawingShared";
import { makeInteractive } from "./officeInteraction";
import {
  drawNotebookIcon,
  drawComputerIcon,
  drawCharacter,
  drawChair,
  drawChairArms,
  drawDesk,
  drawPlant,
  drawPaneDevice,
} from "./officeDrawingPrimitives";

function roomHasActivity(room: OfficeRoom) {
  const activeAgentKeys = new Set(
    room.roomAgents
      .filter(({ semanticStatus }) => semanticStatus !== "idle")
      .map(({ key }) => key),
  );
  return (
    room.roomAgents.some(({ semanticStatus }) => semanticStatus !== "idle") ||
    room.desks.some(({ occupantAgentKey }) =>
      Boolean(occupantAgentKey && activeAgentKeys.has(occupantAgentKey)),
    )
  );
}

function drawRoomHeading(
  parent: Container,
  room: OfficeRoom,
  host: OfficeHost,
  rect: OfficeRoomRect,
  accent: number,
  selectedKey: string | null,
  onSelect: (key: string) => void,
  onActivateRoom: (key: string) => void,
) {
  const fallbackActionWidth = OFFICE_GEOMETRY.roomHeaderActionWidth;
  const fallbackTitleBoxWidth = Math.max(
    0,
    rect.headerRect.width -
      2 *
        (fallbackActionWidth +
          OFFICE_GEOMETRY.roomHeaderActionGap +
          fallbackActionWidth +
          OFFICE_GEOMETRY.roomHeaderCloseGap),
  );
  const fallbackTitleBoxX = Math.max(
    0,
    (rect.headerRect.width - fallbackTitleBoxWidth) / 2,
  );
  const header = rect.header ?? {
    workspace: shortLabel(room.displayLabel, 18),
    host: shortLabel(host.displayLabel, 16),
    width: rect.headerRect.width,
    titleBoxX: fallbackTitleBoxX,
    titleBoxWidth: fallbackTitleBoxWidth,
    renameX:
      fallbackTitleBoxX +
      fallbackTitleBoxWidth +
      OFFICE_GEOMETRY.roomHeaderActionGap,
    closeX: Math.max(0, rect.headerRect.width - fallbackActionWidth),
    renameWidth: fallbackActionWidth,
    closeWidth: fallbackActionWidth,
    actionWidth: fallbackActionWidth,
    actionGap: OFFICE_GEOMETRY.roomHeaderActionGap,
    closeGap: OFFICE_GEOMETRY.roomHeaderCloseGap,
    height: rect.headerRect.height,
    emergencyEllipsis: false,
  };
  const x = rect.headerRect.x + header.titleBoxX;
  const y = rect.headerRect.y;
  const workspace = label(header.workspace.toUpperCase(), {
    size: OFFICE_HEADING_TEXT_SIZE,
    color: 0xffffff,
    anchor: { x: 0, y: 0.5 },
  });
  const hostName = label(header.host.toUpperCase(), {
    size: OFFICE_HEADING_TEXT_SIZE,
    color: 0xf5d892,
    anchor: { x: 0, y: 0.5 },
  });
  const hyphenOne = label("-", {
    size: OFFICE_HEADING_TEXT_SIZE,
    color: 0xf0e6c6,
    anchor: 0.5,
  });
  const hyphenTwo = label("-", {
    size: OFFICE_HEADING_TEXT_SIZE,
    color: 0xf0e6c6,
    anchor: 0.5,
  });
  const titleBoxWidth = Math.min(
    Math.max(0, rect.headerRect.width - header.titleBoxX),
    Math.max(0, header.titleBoxWidth),
  );
  const background = new Graphics();
  background
    .roundRect(x, y, titleBoxWidth, Math.min(22, rect.headerRect.height), 4)
    .fill(
      selectedKey === room.key ? accent : blendColor(accent, 0x121522, 0.5),
    );
  background
    .roundRect(x, y, titleBoxWidth, Math.min(22, rect.headerRect.height), 4)
    .stroke({
      width: selectedKey === room.key ? 2 : 1,
      color: blendColor(accent, 0xffffff, 0.35),
      alpha: 0.84,
    });
  makeInteractive(background, room.key, onSelect, onActivateRoom);
  parent.addChild(background);

  let cursor = x + 10;
  drawNotebookIcon(
    parent,
    cursor,
    y + 3,
    0xf6e3b2,
    room.key,
    onSelect,
    onActivateRoom,
  );
  cursor += 16;
  hyphenOne.position.set(cursor + hyphenOne.width / 2, y + 11);
  makeInteractive(hyphenOne, room.key, onSelect, onActivateRoom);
  parent.addChild(hyphenOne);
  cursor += hyphenOne.width;
  workspace.position.set(cursor, y + 11);
  makeInteractive(workspace, room.key, onSelect, onActivateRoom);
  parent.addChild(workspace);
  cursor += workspace.width + 12;
  drawComputerIcon(
    parent,
    cursor,
    y + 4,
    0xe4f0ff,
    room.key,
    onSelect,
    onActivateRoom,
  );
  cursor += 20;
  hyphenTwo.position.set(cursor + hyphenTwo.width / 2, y + 11);
  makeInteractive(hyphenTwo, room.key, onSelect, onActivateRoom);
  parent.addChild(hyphenTwo);
  cursor += hyphenTwo.width;
  hostName.position.set(cursor, y + 11);
  makeInteractive(hostName, room.key, onSelect, onActivateRoom);
  parent.addChild(hostName);
}

export function drawRoom(
  stage: Container,
  room: OfficeRoom,
  rect: OfficeRoomRect,
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
  completionSeenKeys: ReadonlySet<string>,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
  onActivateRoom: (key: string) => void,
  seatCreationState: OfficeCreationActionState,
  onNewSeat: (roomKey: string) => void,
  floors: OfficeFloorTextures,
) {
  const host = projection.hosts.find(({ key }) => key === room.hostKey);
  if (!host) {
    return;
  }
  const theme = THEMES[host.deterministicSkin.themeIndex % THEMES.length];
  const active = roomHasActivity(room);
  const hasUnseenCompletion = room.desks.some((desk) =>
    desk.completionAgentKeys.some((key) => !completionSeenKeys.has(key)),
  );
  const hasSelectedCompletion = room.desks.some((desk) =>
    desk.completionAgentKeys.includes(selectedKey ?? ""),
  );
  const roomSelected = selectedKey === room.key || hasSelectedCompletion;
  const parent = new Container();
  const floor = new Graphics();
  const floorA = active
    ? blendColor(theme.floorA, 0x5d5138, 0.34)
    : theme.floorA;
  const floorB = active
    ? blendColor(theme.floorB, 0x443a2a, 0.32)
    : theme.floorB;
  floors.draw(
    floor,
    rect.wallRect.x,
    rect.wallRect.y,
    rect.wallRect.width,
    rect.wallRect.height,
    floorA,
    floorB,
  );
  floor
    .rect(
      rect.wallRect.x,
      rect.wallRect.y,
      rect.wallRect.width,
      Math.min(34, rect.wallRect.height),
    )
    .fill({ color: theme.wall, alpha: 0.76 });
  const borderInset = 3;
  floor
    .roundRect(
      rect.x + borderInset,
      rect.y + borderInset,
      Math.max(0, rect.width - borderInset * 2),
      Math.max(0, rect.height - borderInset * 2),
      4,
    )
    .stroke({
      width: roomSelected ? 2 : hasUnseenCompletion ? 2 : 1,
      color: roomSelected
        ? 0xffffff
        : hasUnseenCompletion
          ? 0xf0c878
          : theme.accent,
      alpha: roomSelected ? 0.92 : hasUnseenCompletion ? 0.92 : 0.78,
    });
  makeInteractive(floor, room.key, onSelect, onActivateRoom);
  parent.addChild(floor);
  drawRoomHeading(
    parent,
    room,
    host,
    rect,
    theme.accent,
    selectedKey,
    onSelect,
    onActivateRoom,
  );
  if (rect.overflowMarkerRect) {
    drawRoomOverflowMarker(parent, rect.overflowMarkerRect, theme.accent);
  }
  drawPlant(parent, rect.x + 14, rect.y + rect.height - 18, theme.accent);
  drawPlant(
    parent,
    rect.x + rect.width - 16,
    rect.y + rect.height - 18,
    theme.accent,
  );

  const agentByKey = new Map(
    room.roomAgents.map((agent) => [agent.key, agent]),
  );
  room.desks.forEach((desk, index) => {
    const occupant = desk.occupantAgentKey
      ? agentByKey.get(desk.occupantAgentKey)
      : undefined;
    drawTabDesk(
      parent,
      desk,
      occupant,
      room.roomAgents,
      rect,
      index,
      theme.accent,
      selectedKey,
      completionSeenKeys,
      textures,
      animated,
      onSelect,
      onActivateAgent,
    );
  });
  officeStandingAgentAnchors(room, rect).forEach(({ agent, anchor }) => {
    drawStandingAgent(
      parent,
      agent,
      anchor,
      selectedKey,
      textures,
      animated,
      onSelect,
      onActivateAgent,
    );
  });
  if (seatCreationState.visible) {
    drawNewSeatAction(
      parent,
      room,
      rect,
      room.desks.length,
      theme.accent,
      seatCreationState.enabled,
      onNewSeat,
    );
  }

  const overflow: string[] = [];
  if (room.omittedDeskCount > 0) {
    overflow.push(`+${room.omittedDeskCount} desks`);
  }
  if (room.omittedAgentCount > 0) {
    overflow.push(`+${room.omittedAgentCount} agents`);
  }
  if (overflow.length > 0) {
    const copy = label(`${overflow.join(" · ")} in roster`, {
      size: 9,
      color: 0xd7deea,
      anchor: { x: 1, y: 0 },
    });
    copy.position.set(rect.x + rect.width - 18, rect.y + rect.height - 18);
    parent.addChild(copy);
  }
  if (room.stale) {
    parent.alpha = 0.68;
    const stale = new Graphics();
    stale
      .rect(rect.x, rect.y, rect.width, rect.height)
      .fill({ color: 0x7b2735, alpha: 0.08 });
    parent.addChild(stale);
  }
  stage.addChild(parent);
}

export function drawRoomOverflowMarker(
  parent: Container,
  rect: { x: number; y: number; width: number; height: number },
  accent: number,
) {
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const marker = new Graphics();
  marker
    .roundRect(rect.x, rect.y, rect.width, rect.height, 3)
    .fill({ color: 0x1b202b, alpha: 0.96 })
    .stroke({ width: 1, color: accent, alpha: 0.86 });
  parent.addChild(marker);
  const text = label("MORE", { size: 7, color: 0xf0c878, anchor: 0.5 });
  text.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
  parent.addChild(text);
}

function drawNewSeatAction(
  parent: Container,
  room: OfficeRoom,
  rect: OfficeRoomRect,
  index: number,
  accent: number,
  enabled: boolean,
  onNewSeat: (roomKey: string) => void,
) {
  const anchor =
    index >= OFFICE_GEOMETRY.desksPerRoom
      ? {
          x: rect.x + rect.width / 2,
          deskY: rect.y + rect.height - 40,
          nameY: rect.y + rect.height - 12,
        }
      : deskAnchor(rect, index);
  const action = new Container();
  action.label = room.key;
  action.eventMode = "static";
  action.cursor = enabled ? "pointer" : "not-allowed";
  if (enabled) {
    action.on("pointertap", (event) => {
      event.stopPropagation();
      onNewSeat(room.key);
    });
  }
  const plate = new Graphics();
  // Keep the visible + target self-describing for Pixi's hit-test walk so
  // hover callouts work on the empty-seat action as well as on desks.
  plate.label = room.key;
  plate.eventMode = "static";
  plate.cursor = enabled ? "pointer" : "not-allowed";
  plate
    .roundRect(anchor.x - 25, anchor.deskY, 50, 27, 5)
    .fill({ color: accent, alpha: enabled ? 0.1 : 0.04 })
    .stroke({ width: 1, color: accent, alpha: enabled ? 0.8 : 0.38 });
  action.addChild(plate);
  const plus = label("+", {
    size: 19,
    color: enabled ? 0xf4e6c0 : 0x9c947f,
    anchor: 0.5,
    weight: "700",
  });
  plus.alpha = enabled ? 1 : 0.62;
  plus.eventMode = "none";
  plus.position.set(anchor.x, anchor.deskY + 13);
  action.addChild(plus);
  const hint = label("NEW SEAT", {
    size: 7,
    color: enabled ? 0xa9c8a4 : 0x8e958a,
    anchor: 0.5,
  });
  hint.eventMode = "none";
  hint.position.set(anchor.x, anchor.nameY + 7);
  action.addChild(hint);
  parent.addChild(action);
}

function drawTabDesk(
  parent: Container,
  desk: OfficeDesk,
  occupant: OfficeAgent | undefined,
  roomAgents: OfficeAgent[],
  rect: OfficeRoomRect,
  index: number,
  accent: number,
  selectedKey: string | null,
  completionSeenKeys: ReadonlySet<string>,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const anchor = deskAnchor(rect, index);
  const deskSelected =
    selectedKey === desk.key ||
    selectedKey === occupant?.key ||
    desk.completionAgentKeys.includes(selectedKey ?? "");
  const tabName = label(shortLabel(desk.displayLabel, 18), {
    size: 9,
    color: deskSelected ? 0xffffff : 0xdce6f3,
    anchor: 0.5,
  });
  const plateWidth = Math.max(
    58,
    Math.min(anchor.stationSpan - 6, tabName.width + 14),
  );
  const tabPlate = new Graphics();
  tabPlate
    .roundRect(anchor.x - plateWidth / 2, anchor.nameY, plateWidth, 16, 4)
    .fill({ color: deskSelected ? accent : 0x1c2736, alpha: 0.96 });
  tabPlate
    .roundRect(anchor.x - plateWidth / 2, anchor.nameY, plateWidth, 16, 4)
    .stroke({ width: deskSelected ? 2 : 1, color: accent, alpha: 0.82 });
  makeInteractive(tabPlate, desk.key, onSelect, onActivateAgent);
  parent.addChild(tabPlate);
  tabName.position.set(anchor.x, anchor.nameY + 8);
  makeInteractive(tabName, desk.key, onSelect, onActivateAgent);
  parent.addChild(tabName);

  const chairY = anchor.characterFeetY - OFFICE_GEOMETRY.characterHeight * 0.18;
  drawChair(parent, anchor.x, chairY, accent);
  if (occupant) {
    const cue = occupant.stale
      ? { label: "STALE", color: 0x79869a }
      : STATUS_CUES[occupant.semanticStatus];
    const status = label(
      `${shortLabel(occupant.displayLabel, 14)} · ${cue.label}`,
      {
        size: 9,
        color: 0x111722,
        anchor: 0.5,
      },
    );
    const statusWidth = Math.max(
      54,
      Math.min(anchor.stationSpan - 4, status.width + 10),
    );
    const statusPlate = new Graphics();
    statusPlate
      .roundRect(
        anchor.x - statusWidth / 2,
        anchor.nameY + 18,
        statusWidth,
        15,
        3,
      )
      .fill({ color: cue.color, alpha: 0.96 });
    makeInteractive(statusPlate, occupant.key, onSelect, onActivateAgent);
    parent.addChild(statusPlate);
    status.position.set(anchor.x, anchor.nameY + 25.5);
    makeInteractive(status, occupant.key, onSelect, onActivateAgent);
    parent.addChild(status);
    if (occupant.semanticStatus === "working" && !occupant.stale) {
      animated.push({
        kind: "status",
        node: statusPlate,
        baseAlpha: 1,
        phase: animated.length * 7,
      });
    }
    const character = drawCharacter(
      parent,
      textures[occupant.characterIndex] ?? Texture.EMPTY,
      anchor.x,
      anchor.characterFeetY,
      occupant.semanticStatus === "working",
      occupant.stale,
      animated,
      occupant.key,
      onSelect,
      deskSelected ? occupant.key : selectedKey,
      onActivateAgent,
    );
    character.alpha = occupant.stale ? 0.56 : 1;
    drawChairArms(parent, anchor.x, chairY, accent);
  } else {
    drawChairArms(parent, anchor.x, chairY, accent);
    const empty = label("EMPTY", { size: 8, color: 0x7f8da1, anchor: 0.5 });
    empty.position.set(anchor.x, anchor.nameY + 25);
    parent.addChild(empty);
  }
  const deskNode = drawDesk(
    parent,
    anchor.x - OFFICE_GEOMETRY.deskWidth / 2,
    anchor.deskY,
    accent,
    occupant?.semanticStatus === "working" && !occupant.stale,
    animated,
    deskSelected,
    desk.paneDevices.length === 0,
  );
  makeInteractive(deskNode, desk.key, onSelect, onActivateAgent);
  desk.paneDevices.forEach((device, paneIndex) => {
    const point = paneDeviceAnchor(rect, index, paneIndex);
    drawPaneDevice(
      parent,
      device,
      roomAgents.some(({ key }) => key === device.agentKey),
      point.x,
      point.y,
      paneIndex === 0,
      desk.observedPaneCount,
      selectedKey,
      onSelect,
      onActivateAgent,
    );
  });
  if (desk.completionAgentKeys.some((key) => !completionSeenKeys.has(key))) {
    drawCompletionMarker(
      parent,
      desk,
      anchor,
      completionSeenKeys,
      onSelect,
      onActivateAgent,
    );
  }
}

function drawCompletionMarker(
  parent: Container,
  desk: OfficeDesk,
  anchor: ReturnType<typeof deskAnchor>,
  completionSeenKeys: ReadonlySet<string>,
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const unseenKeys = desk.completionAgentKeys.filter(
    (key) => !completionSeenKeys.has(key),
  );
  const primaryKey = unseenKeys[0];
  if (!primaryKey) {
    return;
  }
  const unseenCount = unseenKeys.length;
  const marker = new Container();
  marker.position.set(anchor.x + 17, anchor.deskY - 16);
  marker.alpha = unseenCount > 0 ? 1 : 0.48;
  const sheets = new Graphics();
  sheets.roundRect(-10, -7, 18, 13, 2).fill(0xf2e3bd);
  sheets.roundRect(-7, -10, 18, 13, 2).fill(0xfff4d0);
  sheets.rect(-3, -6, 9, 1).fill(0xb28d58);
  sheets.rect(-3, -3, 7, 1).fill(0xb28d58);
  sheets.rect(-3, 0, 9, 1).fill(0xb28d58);
  sheets.poly([4, 3, 8, 0, 8, 4]).fill(0x77b889);
  sheets
    .moveTo(4, 2)
    .lineTo(5.5, 3.5)
    .lineTo(8, 0.5)
    .stroke({ width: 1.6, color: 0x2f704b, alpha: 1 });
  marker.addChild(sheets);
  if (unseenCount > 1) {
    const count = label(`+${unseenCount - 1}`, {
      size: 7,
      color: 0x251c12,
      anchor: 0.5,
    });
    const countPlate = new Graphics();
    countPlate.circle(11, -9, 7).fill(0xf0c878);
    marker.addChild(countPlate);
    count.position.set(11, -9);
    marker.addChild(count);
  }
  makeInteractive(marker, primaryKey, onSelect, onActivateAgent);
  parent.addChild(marker);
}

function drawStandingAgent(
  parent: Container,
  agent: OfficeAgent,
  anchor:
    | ReturnType<typeof standingAnchor>
    | ReturnType<typeof import("./officeGeometry").deskStandingAnchor>,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const cue = agent.stale
    ? { label: "STALE", color: 0x79869a }
    : STATUS_CUES[agent.semanticStatus];
  if ("compact" in anchor) {
    const character = drawCharacter(
      parent,
      textures[agent.characterIndex] ?? Texture.EMPTY,
      anchor.x,
      anchor.characterFeetY,
      agent.semanticStatus === "working",
      agent.stale,
      animated,
      agent.key,
      onSelect,
      selectedKey,
      onActivateAgent,
    );
    character.scale.set(0.62);
    character.alpha = agent.stale ? 0.56 : 1;
    const marker = new Graphics();
    marker.circle(anchor.x + 11, anchor.characterFeetY - 31, 4).fill(cue.color);
    makeInteractive(marker, agent.key, onSelect, onActivateAgent);
    parent.addChild(marker);
    return;
  }
  const name = label(shortLabel(agent.displayLabel, 13), {
    size: 9,
    color: 0xf2f4f8,
    anchor: 0.5,
  });
  name.position.set(anchor.x, anchor.nameY + 6);
  makeInteractive(name, agent.key, onSelect, onActivateAgent);
  parent.addChild(name);
  const state = label(cue.label, { size: 7, color: cue.color, anchor: 0.5 });
  state.position.set(anchor.x, anchor.nameY + 18);
  makeInteractive(state, agent.key, onSelect, onActivateAgent);
  parent.addChild(state);
  const character = drawCharacter(
    parent,
    textures[agent.characterIndex] ?? Texture.EMPTY,
    anchor.x,
    anchor.characterFeetY,
    agent.semanticStatus === "working",
    agent.stale,
    animated,
    agent.key,
    onSelect,
    selectedKey,
    onActivateAgent,
  );
  character.alpha = agent.stale ? 0.56 : 1;
}
