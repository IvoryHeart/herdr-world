/**
 * The Town canvas host's rectangle on the page, read again only after
 * something could have moved it: the host resizing, the window resizing or
 * zooming, or a scroll of the page or of a box that holds the host. Anchors
 * for World's connector lines follow every drawn frame; reading the
 * rectangle there forced a layout each frame (#1248).
 */
export class TownHostRect {
  private rect: DOMRect | null = null;
  private readonly stop: () => void;

  constructor(private readonly host: HTMLElement) {
    const stale = () => {
      this.rect = null;
    };
    const scrolled = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && target.contains(host)) stale();
    };
    const resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(stale) : null;
    resize?.observe(host);
    const viewport = window.visualViewport;
    window.addEventListener("resize", stale);
    viewport?.addEventListener("resize", stale);
    viewport?.addEventListener("scroll", stale);
    document.addEventListener("scroll", scrolled, {
      capture: true,
      passive: true,
    });
    this.stop = () => {
      resize?.disconnect();
      window.removeEventListener("resize", stale);
      viewport?.removeEventListener("resize", stale);
      viewport?.removeEventListener("scroll", stale);
      document.removeEventListener("scroll", scrolled, { capture: true });
    };
  }

  get(): DOMRect {
    return (this.rect ??= this.host.getBoundingClientRect());
  }

  /** Read again next time: the host's surroundings changed. */
  invalidate() {
    this.rect = null;
  }

  dispose() {
    this.stop();
    this.rect = null;
  }
}
