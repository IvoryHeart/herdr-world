import { describe, expect, it, vi } from "vitest";
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
    expect(first.destroy).toHaveBeenCalledExactlyOnceWith(OFFICE_SCENE_DESTROY_OPTIONS);
    expect(second.destroy).toHaveBeenCalledExactlyOnceWith(OFFICE_SCENE_DESTROY_OPTIONS);
  });
});
