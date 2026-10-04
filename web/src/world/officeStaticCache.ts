import { Container } from "pixi.js";

/** Cache static runs in painter order, leaving animated nodes and hit targets intact. */
export function cacheOfficeStaticContent(
  root: Container,
  moving: ReadonlySet<Container>,
  resolution: number,
  pixelBudget: number,
) {
  // A cached sprite applies inherited opacity once to the flattened artwork.
  // The vector scene applies it per primitive, so overlapping translucent
  // ancestors (notably stale rooms) must retain their original compositing.
  for (
    let ancestor: Container | null = root;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (ancestor.alpha !== 1) return 0;
  }
  const dynamic = new Set<Container>();
  for (const node of moving) {
    for (
      let ancestor: Container | null = node;
      ancestor;
      ancestor = ancestor.parent
    ) {
      dynamic.add(ancestor);
      if (ancestor === root) break;
    }
  }
  let pixels = 0;
  const cache = (container: Container) => {
    if (container.children.length < 4) return false;
    const bounds = container.getLocalBounds();
    const width = Math.ceil(bounds.width * resolution);
    const height = Math.ceil(bounds.height * resolution);
    // Power-of-two backing storage is a conservative bound for Pixi's texture pool.
    const area =
      2 ** Math.ceil(Math.log2(Math.max(1, width))) *
      2 ** Math.ceil(Math.log2(Math.max(1, height)));
    if (
      !width ||
      !height ||
      width > 2048 ||
      height > 2048 ||
      pixels + area > pixelBudget
    )
      return false;
    container.cacheAsTexture({ resolution, antialias: true });
    pixels += area;
    return true;
  };
  const visit = (container: Container) => {
    if (moving.has(container) || container.alpha !== 1) return;
    if (!dynamic.has(container)) {
      if (!cache(container)) {
        for (const child of container.children) visit(child);
      }
      return;
    }
    let run: Container[] = [];
    const flush = () => {
      if (run.length >= 4) {
        const index = container.getChildIndex(run[0]);
        const group = new Container();
        for (const child of run) group.addChild(child);
        container.addChildAt(group, index);
        cache(group);
      }
      run = [];
    };
    for (const child of [...container.children]) {
      if (dynamic.has(child)) {
        flush();
        visit(child);
      } else run.push(child);
    }
    flush();
  };
  visit(root);
  return pixels;
}
