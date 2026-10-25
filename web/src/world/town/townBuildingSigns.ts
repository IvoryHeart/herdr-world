type SignNode = {
  style: Pick<CSSStyleDeclaration, "opacity" | "visibility">;
};

/** Only committed DOM signs participate in the renderer's roof fade. */
export class TownBuildingSigns {
  private readonly nodes = new Map<string, { node: SignNode }>();

  constructor(private readonly requestFrame: () => void) {}

  /** Creating a ref during an abandoned render must not register anything. */
  ref(hostKey: string) {
    let release: (() => void) | undefined;
    return (node: SignNode | null) => {
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
      this.requestFrame();
    };
  }

  update(roofAlpha: (hostKey: string) => number) {
    for (const [hostKey, { node }] of this.nodes) {
      const opacity = String(Math.round(roofAlpha(hostKey) * 100) / 100);
      const visibility = opacity === "0" ? "hidden" : "visible";
      if (node.style.opacity !== opacity) node.style.opacity = opacity;
      if (node.style.visibility !== visibility)
        node.style.visibility = visibility;
    }
  }
}
