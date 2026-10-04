import { expect, test } from "bun:test";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { OFFICE_SCENE_DESTROY_OPTIONS } from "./officeRendererResources";

test("scene destruction releases child graphics but retains shared textures", () => {
  const root = new Container();
  const graphic = root.addChild(new Graphics().rect(0, 0, 20, 20).fill(0));
  const texture = new Texture();
  const sprite = root.addChild(new Sprite(texture));
  root.destroy(OFFICE_SCENE_DESTROY_OPTIONS);
  expect(graphic.destroyed).toBe(true);
  expect(sprite.destroyed).toBe(true);
  expect(texture.destroyed).toBe(false);
  texture.destroy();
});
