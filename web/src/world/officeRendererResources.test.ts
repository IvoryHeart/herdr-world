import { describe, expect, mock, test } from "bun:test";

const it = test;
const vi = { fn: mock };
import {
  destroyOfficeSceneChildren,
  OFFICE_SCENE_DESTROY_OPTIONS,
} from "./officeRendererResources";

describe("Office renderer resource cleanup", () => {
  it("destroys descendant graphics contexts and text styles but preserves shared textures", () => {
    const first = { destroy: vi.fn() };
    const second = { destroy: vi.fn() };

    destroyOfficeSceneChildren({ removeChildren: () => [first, second] });

    expect(OFFICE_SCENE_DESTROY_OPTIONS).toEqual({
      children: true,
      context: true,
      style: true,
    });
    expect(OFFICE_SCENE_DESTROY_OPTIONS).not.toHaveProperty("texture");
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(first.destroy).toHaveBeenCalledWith(OFFICE_SCENE_DESTROY_OPTIONS);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledWith(OFFICE_SCENE_DESTROY_OPTIONS);
  });
});
