import type { TownClock } from "./scene/ports";

/**
 * Elements whose CSS reads Town's zoom: `--z` (the camera zoom) or `--iz`
 * (its inverse, which keeps signs and labels one size on screen). Both are
 * registered as non-inherited (`@property` in town.css), so a zoom step
 * restyles only these elements, not the whole overlay under `.town-world`
 * (about 2,000 elements, #1248). townWorldTransform.test.ts fails when a rule
 * that reads either variable selects an element this list misses.
 *
 * @internal
 */
export const TOWN_ZOOM_READERS = [
  ".town-apartments-sign",
  ".town-arrival-tag",
  ".town-board",
  ".town-building-sign",
  ".town-bus-clock",
  ".town-bus-more",
  ".town-center-sign",
  ".town-desk-card",
  ".town-desk-more",
  ".town-desk-tag",
  ".town-expenses-city",
  ".town-fold-tile",
  ".town-fuel-mark",
  ".town-harbour-board",
  ".town-harbour-fold",
  ".town-harbour-lamp",
  ".town-harbour-sign",
  ".town-harbour-tag",
  ".town-harbour-tally",
  ".town-lens-room-label",
  ".town-lens-search-mark",
  ".town-lens-search-pulse",
  ".town-library-fold",
  ".town-library-sign",
  ".town-new-seat",
  ".town-observatory-fold",
  ".town-observatory-sign",
  ".town-post-fold",
  ".town-post-label",
  ".town-post-sign",
  ".town-pulse",
  ".town-quest",
  ".town-reception",
  ".town-room-card-frame",
  ".town-room-overview-card",
  ".town-room-plaque",
  ".town-step",
  ".town-team-link",
  ".town-team-wall",
  ".town-tired",
  ".town-warehouse-fold",
  ".town-warehouse-label",
  ".town-warehouse-sign",
] as const;

/**
 * Elements that read the zoom only while focused: about one semantic target
 * per desk, agent and room (over 1,000 at scale), whose keyboard focus ring
 * keeps one width on screen. Only the focused one carries the zoom.
 *
 * @internal
 */
export const TOWN_ZOOM_FOCUS_READERS = [
  ".town-targets .world-semantic-target",
] as const;

const READERS = TOWN_ZOOM_READERS.join(",");
const FOCUS_READERS = TOWN_ZOOM_FOCUS_READERS.join(",");

/**
 * How long the overlay stays its own compositor layer after the camera last
 * moved. While it moves, the browser moves the composited layer instead of
 * re-rasterizing its many children each frame (which showed undrawn tiles);
 * once still, it goes back to an ordinary layer, so text is rasterized at the
 * settled zoom exactly as before.
 *
 * @internal
 */
export const TOWN_WORLD_SETTLE_MS = 250;

type Layer = Pick<
  HTMLElement,
  "style" | "querySelectorAll" | "addEventListener" | "removeEventListener"
>;

/**
 * Places Town's DOM overlay (`.town-world`) under the drawn camera: its
 * transform, the zoom its readers size themselves by, and a compositor layer
 * while the camera moves. Writes happen only when a value changes.
 */
export class TownWorldTransform {
  private transform = "";
  private zoom = 1;
  private readers: ElementCSSInlineStyle[] | null = null;
  private readonly observer: MutationObserver | null;
  private promoted = false;
  private movedAt = 0;
  private cancelSettle: (() => void) | null = null;
  private focused: (Element & ElementCSSInlineStyle) | null = null;

  constructor(
    private readonly layer: Layer,
    private readonly clock: TownClock,
  ) {
    // Elements mount, unmount and change class with React's commits; a new
    // reader gets the current zoom before the browser paints it.
    this.observer =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            this.readers = null;
            this.writeZoom();
          })
        : null;
    this.observer?.observe(layer as unknown as Node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    layer.addEventListener("focusin", this.focusIn);
    layer.addEventListener("focusout", this.focusOut);
  }

  private readonly focusIn = (event: Event) => {
    const target = event.target as Element & ElementCSSInlineStyle;
    this.focused = target.matches?.(FOCUS_READERS) ? target : null;
    if (this.focused) writeZoom(this.focused.style, this.zoom);
  };

  private readonly focusOut = () => {
    this.focused = null;
  };

  /** The overlay at `(tx, ty)` and scale `z`, as the canvas draws it. */
  place(tx: number, ty: number, z: number) {
    const transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    if (transform !== this.transform) {
      // The first pose is where Town opens, not motion.
      if (this.transform) this.moved();
      this.transform = transform;
      this.layer.style.transform = transform;
    }
    if (z !== this.zoom) {
      this.zoom = z;
      this.writeZoom();
    }
  }

  dispose() {
    this.observer?.disconnect();
    this.layer.removeEventListener("focusin", this.focusIn);
    this.layer.removeEventListener("focusout", this.focusOut);
    this.cancelSettle?.();
    this.cancelSettle = null;
  }

  private writeZoom() {
    this.readers ??= [
      ...(this.layer.querySelectorAll(
        READERS,
      ) as unknown as Iterable<ElementCSSInlineStyle>),
    ];
    for (const { style } of this.readers) writeZoom(style, this.zoom);
    if (this.focused) writeZoom(this.focused.style, this.zoom);
  }

  private moved() {
    this.movedAt = this.clock.now();
    if (!this.promoted) {
      this.promoted = true;
      this.layer.style.willChange = "transform";
    }
    if (!this.cancelSettle) this.settleAfter(TOWN_WORLD_SETTLE_MS);
  }

  private settleAfter(ms: number) {
    this.cancelSettle = this.clock.after(ms, () => {
      this.cancelSettle = null;
      const still = this.clock.now() - this.movedAt;
      if (still < TOWN_WORLD_SETTLE_MS)
        return this.settleAfter(TOWN_WORLD_SETTLE_MS - still);
      this.promoted = false;
      this.layer.style.willChange = "";
    });
  }
}

function writeZoom(style: CSSStyleDeclaration, zoom: number) {
  const z = String(zoom);
  const iz = String(1 / zoom);
  // The same value is no change: the browser restyles nothing.
  if (style.getPropertyValue("--z") !== z) style.setProperty("--z", z);
  if (style.getPropertyValue("--iz") !== iz) style.setProperty("--iz", iz);
}
