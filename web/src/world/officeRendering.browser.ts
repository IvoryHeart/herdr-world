import { Application, Container, Graphics, Rectangle } from "pixi.js";
import { OfficeFloorTextures } from "./officeFloorTextures";
import { cacheOfficeStaticContent } from "./officeStaticCache";

/** Pixel comparisons, including fractional floor origins and overlapping animated art. */
export async function verifyOfficeRendering(
  check: (value: boolean, message: string) => void,
) {
  const app = new Application();
  await app.init({
    width: 200,
    height: 200,
    autoStart: false,
    antialias: true,
    backgroundAlpha: 0,
    preference: "webgl",
  });
  const floors = new OfficeFloorTextures();
  const frame = new Rectangle(0, 0, 200, 200);
  const pixels = (target: Container, resolution: number) =>
    app.renderer.extract.pixels({ target, frame, resolution, antialias: true })
      .pixels;
  const difference = (
    a: Uint8Array | Uint8ClampedArray,
    b: Uint8Array | Uint8ClampedArray,
  ) => {
    let changed = 0;
    for (let index = 0; index < a.length; index += 4) {
      if (
        [0, 1, 2, 3].some(
          (channel) => Math.abs(a[index + channel] - b[index + channel]) > 2,
        )
      )
        changed++;
    }
    return changed / (a.length / 4);
  };
  try {
    for (const resolution of [1, 2]) {
      const fractional = new Container();
      fractional.addChild(
        ...Array.from({ length: 4 }, () =>
          new Graphics().rect(0.5, 0.5, 63.8, 63.8).fill(0xabcdef),
        ),
      );
      const admitted = cacheOfficeStaticContent(
        fractional,
        new Set(),
        resolution,
        65536,
      );
      pixels(fractional, resolution);
      const backing = fractional.renderGroup?.texture?.source;
      check(
        !!backing && backing.pixelWidth * backing.pixelHeight <= admitted,
        "Fractional cache backing exceeded its admitted device-pixel budget",
      );
      fractional.destroy({ children: true, context: true });
      for (const origin of [4, 4.5]) {
        const reference = new Graphics();
        const optimized = new Graphics();
        for (let y = 0; y < 133; y += 20) {
          for (let x = 0; x < 151; x += 20) {
            reference
              .rect(origin + x, origin + y, 20, 20)
              .fill(((x + y) / 20) % 2 ? 0x0e0e1d : 0x131328);
          }
        }
        floors.draw(optimized, origin, origin, 151, 133, 0x131328, 0x0e0e1d);
        const ratio = difference(
          pixels(reference, resolution),
          pixels(optimized, resolution),
        );
        check(
          ratio < 0.01,
          `Office floor pixels changed at DPR ${resolution}, origin ${origin}: ${ratio}`,
        );
        check(
          origin !== 4 || optimized.context.instructions.length === 1,
          "Office floor work grows with the tile count",
        );
        reference.destroy({ context: true });
        optimized.destroy({ context: true });
      }
      for (const inheritedAlpha of [1, 0.68]) {
        const scene = new Container({ alpha: inheritedAlpha });
        for (let index = 0; index < 4; index++)
          scene.addChild(
            new Graphics()
              .roundRect(10 + index * 12, 10, 80, 60, 5)
              .fill({ color: 0x5599cc, alpha: 0.8 }),
          );
        const moving = scene.addChild(
          new Graphics().circle(65, 60, 24).fill(0xec8799),
        );
        for (let index = 0; index < 4; index++)
          scene.addChild(
            new Graphics()
              .roundRect(20 + index * 12, 65, 60, 20, 3)
              .fill({ color: 0xf0c878, alpha: 0.8 }),
          );
        const reference = pixels(scene, resolution);
        moving.y = 2;
        const movedReference = pixels(scene, resolution);
        moving.y = 0;
        check(
          cacheOfficeStaticContent(scene, new Set([moving]), resolution, 1e6) >
            0 ===
            (inheritedAlpha === 1),
          "Office static content was not cached",
        );
        check(
          difference(reference, pixels(scene, resolution)) < 0.01,
          "Static Office caching changed painter order or appearance",
        );
        moving.y = 2;
        check(
          difference(movedReference, pixels(scene, resolution)) < 0.01,
          "Office cached art covered or froze animation",
        );
        scene.destroy({ children: true, context: true });
      }
    }
  } finally {
    app.destroy(true, { children: true });
    floors.destroy();
  }
}
