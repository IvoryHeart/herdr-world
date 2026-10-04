import { Graphics, GraphicsContext } from "pixi.js";

const artwork = new Map<
  string,
  { context: GraphicsContext; references: number }
>();

/** Immutable furniture geometry shared until its last live instance retires. */
export function officeArtwork(
  key: string,
  draw: (context: GraphicsContext) => void,
) {
  let entry = artwork.get(key);
  if (!entry) {
    const context = new GraphicsContext();
    draw(context);
    entry = { context, references: 0 };
    artwork.set(key, entry);
  }
  entry.references++;
  const shared = entry;
  return new (class extends Graphics {
    override destroy(options?: Parameters<Graphics["destroy"]>[0]) {
      if (this.destroyed) return;
      // Scene cleanup owns this instance, but other layers may use its context.
      super.destroy({
        ...(typeof options === "object" ? options : { children: options }),
        context: false,
      });
      if (--shared.references === 0) {
        artwork.delete(key);
        shared.context.destroy();
      }
    }
  })({ context: entry.context });
}
