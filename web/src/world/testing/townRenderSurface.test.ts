import { expect, test } from "bun:test";
import { frameRenderSurface } from "./townRenderSurface";
import {
  createTownRaster,
  createTownRenderSurface,
  injectTownRenderSurface,
} from "../town/townRenderSurface";

test("a later ground-fill step retains the pending raster and acknowledges only the latest scene", () => {
  let pending: (() => void) | undefined;
  const restore = injectTownRenderSurface(() => ({
    draw: (submit) => {
      pending = submit;
    },
    destroy() {
      pending = undefined;
    },
  }));
  try {
    const surface = createTownRaster();
    const calls: string[] = [];
    surface.draw(
      true,
      () => calls.push("old"),
      () => calls.push("old acknowledgement"),
    );
    surface.draw(
      false,
      () => calls.push("latest"),
      () => calls.push("latest acknowledgement"),
    );
    expect(calls).toEqual([]);
    pending!();
    expect(calls).toEqual(["latest", "latest acknowledgement"]);
    surface.destroy();
    expect(pending).toBeUndefined();
  } finally {
    restore();
  }
});

test("production submits each requested raster synchronously", () => {
  const values: number[] = [];
  const surface = createTownRenderSurface();
  surface.draw(() => values.push(1));
  surface.draw(() => values.push(2));
  expect(values).toEqual([1, 2]);
  surface.destroy();
});

test("test frames present the latest scene and acknowledge only its actual draw", () => {
  const frames = new Map<number, () => void>();
  let id = 0;
  const restore = injectTownRenderSurface(() =>
    frameRenderSurface(
      (run) => {
        frames.set(++id, run);
        return id;
      },
      (key) => {
        frames.delete(key);
      },
    ),
  );
  try {
    const surface = createTownRenderSurface();
    const drawn: number[] = [];
    surface.draw(() => drawn.push(1));
    surface.draw(() => drawn.push(2));
    expect(frames.size).toBe(1);
    expect(drawn).toEqual([]);
    const first = frames.get(1)!;
    frames.delete(1);
    first();
    expect(drawn).toEqual([2]);
    surface.draw(() => drawn.push(3));
    expect(frames.size).toBe(1);
    surface.destroy();
    expect(frames.size).toBe(0);
    surface.draw(() => drawn.push(4));
    expect(frames.size).toBe(0);
    expect(drawn).toEqual([2]);
  } finally {
    restore();
  }
});
