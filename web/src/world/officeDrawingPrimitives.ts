/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { OfficeAgent, OfficePaneDevice } from "./herdrOfficeProjection";
import { OFFICE_GEOMETRY } from "./officeGeometry";
import { officeArtwork } from "./officeArtwork";
import { type AnimatedItem } from "./officeRendererTypes";
import { label, blendColor } from "./officeDrawingShared";
import { makeInteractive } from "./officeInteraction";

export function drawNotebookIcon(
  parent: Container,
  x: number,
  y: number,
  color: number,
  key: string,
  onSelect: (key: string) => void,
  onActivate: (key: string) => void,
) {
  const icon = new Graphics();
  icon.roundRect(x + 2, y, 12, 16, 2).fill({ color, alpha: 0.94 });
  icon.rect(x + 4, y + 4, 7, 1).fill(0x604e35);
  icon.rect(x + 4, y + 7, 7, 1).fill(0x604e35);
  icon.rect(x + 4, y + 10, 5, 1).fill(0x604e35);
  icon.rect(x, y + 3, 2, 10).fill(blendColor(color, 0x0c101a, 0.35));
  makeInteractive(icon, key, onSelect, onActivate);
  parent.addChild(icon);
}

export function drawComputerIcon(
  parent: Container,
  x: number,
  y: number,
  color: number,
  key: string,
  onSelect: (key: string) => void,
  onActivate: (key: string) => void,
) {
  const icon = new Graphics();
  icon.roundRect(x, y, 17, 11, 2).fill({ color, alpha: 0.94 });
  icon.roundRect(x + 3, y + 3, 11, 5, 1).fill(0x344a5e);
  icon.rect(x + 7, y + 11, 3, 3).fill(color);
  icon.rect(x + 4, y + 14, 9, 1).fill(color);
  makeInteractive(icon, key, onSelect, onActivate);
  parent.addChild(icon);
}

export function drawCharacter(
  parent: Container,
  texture: Texture,
  x: number,
  feetY: number,
  working: boolean,
  stale: boolean,
  animated: AnimatedItem[],
  key: string,
  onSelect: (key: string) => void,
  selectedKey: string | null,
  onActivateAgent?: (key: string) => void,
) {
  const container = new Container();
  container.position.set(x, feetY);
  // The sprite texture contains transparent pixels and is not a comfortable
  // interaction target by itself. Give the whole character silhouette a
  // stable rectangular hit region so the tooltip follows ordinary pointer
  // movement over the character, not only opaque texture pixels.
  container.hitArea = new Rectangle(
    -24,
    -OFFICE_GEOMETRY.characterHeight - 8,
    48,
    OFFICE_GEOMETRY.characterHeight + 18,
  );
  addCharacterSprite(container, texture);
  const hitTarget = new Graphics();
  hitTarget
    .rect(
      -24,
      -OFFICE_GEOMETRY.characterHeight - 8,
      48,
      OFFICE_GEOMETRY.characterHeight + 18,
    )
    .fill({ color: 0xffffff, alpha: 0.0001 });
  makeInteractive(hitTarget, key, onSelect, onActivateAgent);
  container.addChild(hitTarget);
  if (selectedKey === key) {
    const selected = new Graphics();
    selected
      .ellipse(0, -2, 25, 8)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    container.addChildAt(selected, 0);
  }
  makeInteractive(container, key, onSelect, onActivateAgent);
  if (working && !stale) {
    animated.push({
      kind: "character",
      node: container,
      baseY: feetY,
      phase: animated.length * 7,
    });
  }
  parent.addChild(container);
  return container;
}

export function addCharacterSprite(container: Container, texture: Texture) {
  if (texture !== Texture.EMPTY) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(
      OFFICE_GEOMETRY.characterHeight / Math.max(1, texture.height),
    );
    sprite.roundPixels = true;
    container.addChild(sprite);
  } else {
    const fallback = label("◆", { size: 22, color: 0xb4befe, anchor: 0.5 });
    fallback.position.y = -22;
    container.addChild(fallback);
  }
}

export function drawChair(
  parent: Container,
  x: number,
  y: number,
  accent: number,
) {
  const chair = new Graphics();
  const frame = blendColor(accent, 0x0b0d16, 0.3);
  const cushion = blendColor(accent, 0x20243a, 0.38);
  chair.ellipse(x, y + 13, 28, 7).fill({ color: 0x000000, alpha: 0.24 });
  chair.rect(x - 2, y + 1, 4, 11).fill(frame);
  chair.rect(x - 13, y + 10, 26, 3).fill(frame);
  chair.circle(x - 13, y + 13, 3).fill(frame);
  chair.circle(x + 13, y + 13, 3).fill(frame);
  chair.ellipse(x, y, 27, 11).fill(cushion);
  chair.roundRect(x - 20, y - 31, 40, 22, 7).fill(frame);
  chair.roundRect(x - 16, y - 28, 32, 15, 5).fill(cushion);
  chair
    .roundRect(x - 13, y - 25, 26, 3, 2)
    .fill({ color: accent, alpha: 0.48 });
  parent.addChild(chair);
}

export function drawChairArms(
  parent: Container,
  x: number,
  y: number,
  accent: number,
) {
  const arms = new Graphics();
  const color = blendColor(accent, 0x0e1020, 0.18);
  arms.roundRect(x - 20, y - 14, 6, 17, 3).fill(color);
  arms.roundRect(x + 14, y - 14, 6, 17, 3).fill(color);
  parent.addChild(arms);
}

export function drawDesk(
  parent: Container,
  x: number,
  y: number,
  accent: number,
  working: boolean,
  animated: AnimatedItem[],
  selected = false,
  showMonitor = true,
) {
  const desk = officeArtwork(
    `desk:${accent}:${working}:${selected}:${showMonitor}`,
    (desk) => {
      desk.ellipse(24, 30, 30, 6).fill({ color: 0x000000, alpha: 0.22 });
      desk.roundRect(0, 0, 48, 26, 3).fill(0x765b38);
      desk.roundRect(2, 2, 44, 22, 2).fill(0xae8b5d);
      if (showMonitor) {
        desk
          .roundRect(14, 10, 21, 13, 2)
          .fill(blendColor(accent, 0x101722, 0.7));
        desk.roundRect(16, 12, 17, 8, 1).fill(working ? 0x347d86 : 0x172131);
      }
      desk.rect(1, 24, 46, 2).fill({ color: accent, alpha: 0.78 });
      if (selected) {
        desk
          .roundRect(-3, -3, 54, 32, 5)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.92 });
      }
    },
  );
  desk.position.set(x, y);
  parent.addChild(desk);
  if (working && showMonitor) {
    const glow = new Graphics();
    glow
      .roundRect(x + 16, y + 12, 17, 8, 1)
      .fill({ color: 0xc9fff4, alpha: 0.18 });
    glow.eventMode = "none";
    parent.addChild(glow);
    animated.push({
      kind: "monitor",
      node: glow,
      baseAlpha: 0.18,
      phase: animated.length * 7,
    });
  }
  return desk;
}

export function drawPlant(
  parent: Container,
  x: number,
  y: number,
  accent: number,
) {
  const plant = officeArtwork(`plant:${accent}`, (plant) => {
    const x = 0,
      y = 0;
    plant.roundRect(x - 6, y, 12, 8, 2).fill(0xa65c46);
    plant.circle(x, y - 4, 7).fill(blendColor(accent, 0x4f956f, 0.7));
    plant.circle(x - 5, y - 7, 4).fill(0x5b9c78);
    plant.circle(x + 5, y - 7, 4).fill(0x69aa85);
  });
  plant.position.set(x, y);
  parent.addChild(plant);
}

export function addSign(
  parent: Container,
  x: number,
  y: number,
  value: string,
  color: number,
  width: number,
  key?: string,
  onSelect?: (key: string) => void,
  onActivate?: (key: string) => void,
  textSize = 10,
) {
  const background = officeArtwork(`sign:${color}:${width}`, (background) => {
    const x = 0,
      y = 0;
    background.roundRect(x, y, width, 19, 4).fill(color);
    background.roundRect(x, y, width, 19, 4).stroke({
      width: 1,
      color: blendColor(color, 0xffffff, 0.32),
      alpha: 0.72,
    });
  });
  background.position.set(x, y);
  if (key && onSelect) {
    makeInteractive(background, key, onSelect, onActivate);
  }
  parent.addChild(background);
  const copy = label(value, { size: textSize, color: 0xffffff, anchor: 0.5 });
  copy.position.set(x + width / 2, y + 9.5);
  if (key && onSelect) {
    makeInteractive(copy, key, onSelect, onActivate);
  }
  parent.addChild(copy);
}

export function drawPaneDevice(
  parent: Container,
  device: OfficePaneDevice,
  occupied: boolean,
  x: number,
  y: number,
  primary: boolean,
  paneCount: number,
  selectedKey: string | null,
  onSelect: (key: string) => void,
  onActivate: (key: string) => void,
) {
  const laptop = new Container();
  laptop.position.set(x, y);
  laptop.hitArea = new Rectangle(-12, -12, 24, 24);
  const associated = occupied;
  const color = device.stale ? 0x79869a : associated ? 0x67d6c0 : 0x8d9aae;
  const art = officeArtwork(
    `device:${primary}:${color}:${associated}:${selectedKey === device.key}`,
    (art) => {
      if (primary) {
        art
          .roundRect(-10, -10, 20, 15, 2)
          .fill(0x243247)
          .stroke({
            width: selectedKey === device.key ? 2 : 1,
            color: selectedKey === device.key ? 0xffffff : color,
          });
        art
          .roundRect(-8, -8, 16, 10, 1)
          .fill({ color, alpha: associated ? 0.72 : 0.3 });
        art.poly([-10, 5, 10, 5, 12, 9, -12, 9]).fill(0x52647a);
        art.rect(-5, 6, 10, 1).fill(0x263244);
      } else {
        art
          .roundRect(-10.5, -6.5, 21, 13, 2)
          .fill(0x172131)
          .stroke({
            width: selectedKey === device.key ? 2 : 1,
            color: selectedKey === device.key ? 0xffffff : color,
          });
        art
          .roundRect(-8.5, -4.5, 17, 8, 1)
          .fill(associated ? 0x347d86 : 0x172131);
      }
    },
  );
  laptop.addChild(art);
  if (primary) {
    const number = label(String(paneCount), {
      size: paneCount > 99 ? 5 : paneCount > 9 ? 6 : 7,
      color: 0xeff7ff,
      anchor: 0.5,
    });
    number.position.set(0, -3);
    laptop.addChild(number);
  }
  laptop.alpha = device.stale ? 0.56 : 1;
  makeInteractive(laptop, device.key, onSelect, onActivate);
  parent.addChild(laptop);
}

export function drawReceptionStatusBadge(
  parent: Container,
  agent: OfficeAgent,
  x: number,
  y: number,
  onSelect: (key: string) => void,
  onActivate: (key: string) => void,
) {
  const badge = new Container();
  badge.position.set(x, y);
  const color = agent.semanticStatus === "done" ? 0xf0c878 : 0xec8799;
  const plate = new Graphics();
  plate.circle(0, 0, 10).fill(color).stroke({ width: 1, color: 0x182031 });
  badge.addChild(plate);
  if (agent.semanticStatus === "done") {
    const check = new Graphics();
    check
      .moveTo(-5, 0)
      .lineTo(-1, 4)
      .lineTo(6, -5)
      .stroke({ width: 2.6, color: 0x182031 });
    badge.addChild(check);
  } else {
    const question = label("?", {
      size: 15,
      color: 0x182031,
      anchor: 0.5,
      weight: "700",
    });
    badge.addChild(question);
  }
  makeInteractive(badge, agent.key, onSelect, onActivate);
  parent.addChild(badge);
}
