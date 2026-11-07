/**
 * Each building's DOM layer (its reception, sign and room plaques) follows
 * its building as the renderer draws it: gliding to a new place or fading in
 * after a topology change (townTransition.ts), and plain otherwise. The
 * transform and opacity are set only while a building moves, so its layer is
 * no stacking context the rest of the time.
 */

type LayerNode = {
  style: Pick<CSSStyleDeclaration, "transform" | "opacity">;
};

export type TownBuildingPose = { x: number; y: number; alpha: number } | null;

export class TownBuildingLayers {
  private readonly nodes = new Map<string, { node: LayerNode }>();

  /** Creating a ref during an abandoned render must not register anything. */
  ref(hostKey: string) {
    let release: (() => void) | undefined;
    return (node: LayerNode | null) => {
      release?.();
      release = undefined;
      if (!node) return;
      const registration = { node };
      this.nodes.set(hostKey, registration);
      release = () => {
        // A retiring ref cannot remove another committed node for this key.
        if (this.nodes.get(hostKey) === registration)
          this.nodes.delete(hostKey);
      };
    };
  }

  /** Place every layer where its building is drawn this frame. */
  update(pose: (hostKey: string) => TownBuildingPose) {
    for (const [hostKey, { node }] of this.nodes) {
      const at = pose(hostKey);
      const moved = at && (Math.abs(at.x) >= 0.05 || Math.abs(at.y) >= 0.05);
      const transform = moved
        ? `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`
        : "";
      const opacity =
        at && at.alpha < 0.999 ? String(Math.round(at.alpha * 100) / 100) : "";
      if (node.style.transform !== transform) node.style.transform = transform;
      if (node.style.opacity !== opacity) node.style.opacity = opacity;
    }
  }
}
