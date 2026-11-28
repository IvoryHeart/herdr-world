import type { TownRenderSurface } from "../town/townRenderSurface";

/**
 * A manual clock can step many scene frames in one browser turn. Keep the
 * latest raster submission for the next native frame, rather than filling
 * SwiftShader's queue with pictures that no assertion or user can observe.
 * Scene stepping, geometry, budgets and gap diagnostics still run each time.
 */
export function frameRenderSurface(
  nextFrame: (run: () => void) => number,
  cancelFrame: (id: number) => void,
): TownRenderSurface {
  let pending: (() => void) | undefined;
  let frame: number | undefined;
  let disposed = false;
  return {
    draw(submit) {
      if (disposed) return;
      pending = submit;
      frame ??= nextFrame(() => {
        frame = undefined;
        const draw = pending;
        pending = undefined;
        draw?.();
      });
    },
    destroy() {
      disposed = true;
      pending = undefined;
      if (frame !== undefined) cancelFrame(frame);
      frame = undefined;
    },
  };
}
