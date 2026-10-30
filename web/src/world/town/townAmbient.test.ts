import { expect, test } from "bun:test";
import { TownAmbient, createTownBlink, townSpriteVisible } from "./townAmbient";
import { Container, Sprite, Texture } from "pixi.js";

test("discrete animations retain rate and phase while continuous motion takes precedence", () => {
  const ambient = new TownAmbient(1.1);
  expect(ambient.next).toBe(Infinity);
  ambient.every(6);
  expect(ambient.next).toBeCloseTo(7 / 6);
  ambient.every(7, 3);
  expect(ambient.next).toBeCloseTo(8 / 7);
  ambient.continuous();
  ambient.every(3);
  expect(ambient.next).toBe(1.1);
});

test("a visible blink schedules closing and reopening, then rests until its next blink", () => {
  const blink = createTownBlink();
  const start = new TownAmbient(0);
  expect(blink("synthetic-agent", 0, true, start)).toBe(false);
  const shut = new TownAmbient(start.next);
  expect(blink("synthetic-agent", shut.now, true, shut)).toBe(true);
  expect(shut.next - shut.now).toBeCloseTo(0.13);
  const open = new TownAmbient(shut.next);
  expect(blink("synthetic-agent", open.now, true, open)).toBe(false);
  expect(open.next - open.now).toBeGreaterThanOrEqual(2);
  const hidden = new TownAmbient(open.next);
  blink("synthetic-agent", hidden.now, false, hidden);
  expect(hidden.next).toBe(Infinity);
});

test("sprite visibility includes the viewport, culling and roof-covered ancestry", () => {
  const viewport = {
    width: 390,
    height: 844,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const building = new Container();
  const interior = new Container();
  const sprite = new Sprite(Texture.WHITE);
  sprite.width = sprite.height = 10;
  sprite.position.set(20, 20);
  building.addChild(interior);
  interior.addChild(sprite);
  expect(townSpriteVisible(sprite, viewport)).toBe(true);
  interior.visible = false;
  expect(townSpriteVisible(sprite, viewport)).toBe(false);
  interior.visible = true;
  building.alpha = 0;
  expect(townSpriteVisible(sprite, viewport)).toBe(false);
  building.alpha = 1;
  sprite.x = 400;
  expect(townSpriteVisible(sprite, viewport)).toBe(false);
  sprite.x = -5;
  expect(townSpriteVisible(sprite, viewport)).toBe(true);
  building.destroy({ children: true });
});
