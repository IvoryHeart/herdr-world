/** Raster submission is separate from stepping the scene and its camera. */
export type TownRenderSurface = {
  draw(submit: () => void): void;
  destroy(): void;
};

type SurfaceFactory = () => TownRenderSurface;
let factory: SurfaceFactory = () => ({
  draw: (submit) => submit(),
  destroy() {},
});

export function createTownRenderSurface(): TownRenderSurface {
  return factory();
}

/** Preserve a needed raster when a later scene step only fills ground. */
export function createTownRaster() {
  const surface = createTownRenderSurface();
  let needed = false;
  return {
    draw(render: boolean, submit: () => void, acknowledge: () => void) {
      needed ||= render;
      surface.draw(() => {
        if (needed) {
          submit();
          needed = false;
        }
        acknowledge();
      });
    },
    destroy: () => surface.destroy(),
  };
}

/** @internal Fixtures replace only raster submission, retaining the real scene/handle. */
export function injectTownRenderSurface(replacement: SurfaceFactory) {
  const previous = factory;
  factory = replacement;
  return () => {
    factory = previous;
  };
}
