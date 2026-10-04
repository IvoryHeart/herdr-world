import { expect, test } from "bun:test";
import { Container, Graphics } from "pixi.js";
import { cacheOfficeStaticContent } from "./officeStaticCache";

function decoration() {
  return new Graphics().rect(0, 0, 20, 20).fill(0xabcdef);
}

test("static caching preserves painter order and animated nodes", () => {
  const root = new Container();
  const behind = Array.from({ length: 4 }, decoration);
  const moving = decoration();
  const ahead = Array.from({ length: 4 }, decoration);
  root.addChild(...behind, moving, ...ahead);
  const pixels = cacheOfficeStaticContent(root, new Set([moving]), 2, 8192);
  expect(pixels).toBe(8192);
  expect(root.children).toHaveLength(3);
  expect(root.children[0].children).toEqual(behind);
  expect(root.children[0].isCachedAsTexture).toBe(true);
  expect(root.children[1]).toBe(moving);
  expect(root.children[1].isCachedAsTexture).toBe(false);
  expect(root.children[2].children).toEqual(ahead);
  moving.y = 2;
  expect(behind.every((node) => node.y === 0)).toBe(true);
  root.destroy({ children: true, context: true });
  expect([...behind, moving, ...ahead].every((node) => node.destroyed)).toBe(
    true,
  );
});

test("static caches respect device pixels and the scene memory budget", () => {
  const root = new Container();
  root.addChild(...Array.from({ length: 4 }, decoration));
  expect(cacheOfficeStaticContent(root, new Set(), 2, 4095)).toBe(0);
  expect(root.isCachedAsTexture).toBe(false);
  expect(cacheOfficeStaticContent(root, new Set(), 2, 4096)).toBe(4096);
  root.destroy({ children: true, context: true });
});

test("oversized logical floors are never allocated as cached textures", () => {
  const root = new Container();
  root.addChild(
    ...Array.from({ length: 4 }, () =>
      new Graphics().rect(0, 0, 4096, 8192).fill(0),
    ),
  );
  expect(cacheOfficeStaticContent(root, new Set(), 1, 1e9)).toBe(0);
  expect(root.isCachedAsTexture).toBe(false);
  root.destroy({ children: true, context: true });
});

test("translucent room ancestors retain per-primitive opacity", () => {
  const staleRoom = new Container({ alpha: 0.68 });
  const layer = staleRoom.addChild(new Container());
  layer.addChild(...Array.from({ length: 4 }, decoration));
  expect(cacheOfficeStaticContent(layer, new Set(), 1, 1e6)).toBe(0);
  expect(layer.isCachedAsTexture).toBe(false);
  const wrapper = new Container();
  wrapper.addChild(staleRoom);
  expect(cacheOfficeStaticContent(wrapper, new Set(), 1, 1e6)).toBe(0);
  staleRoom.destroy({ children: true, context: true });
  wrapper.destroy();
});
