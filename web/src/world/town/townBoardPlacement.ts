/**
 * Town's boards keep off the town center, the post office and each other
 * (#790). A reception board stands above its building's front door and the
 * city billboard above the center, but boards keep their screen size while
 * the town zooms, so whether one covers its neighbours depends on the zoom:
 * every drawn frame places the reception boards again (TownCanvas onFrame).
 *
 * A board that would cover something slides sideways, the least it can,
 * while at least a third of it stays over its own building; failing that,
 * it hangs below what it would cover, onto the street before its building.
 */

import { TOWN_CITY_BOARD_GAP, townCityBoardScale } from "./townCenter";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import { townPostLotBeside, townPostReserve } from "./townPostLot";

/** A rectangle in world pixels, x1 and y1 exclusive. */
export type TownBox = { x0: number; y0: number; x1: number; y1: number };

/** A reception board to place, in world pixels at the current zoom. */
export type TownBoardRequest = {
  key: string;
  /** The middle of its foot, where it stands. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its building's left and right edges. */
  x0: number;
  x1: number;
};

export type TownBoardOffset = { dx: number; dy: number };

/** World pixels from a building's top wall up to its reception board's foot. */
export const TOWN_RECEPTION_LIFT = 18;
/** Screen pixels kept between a board and what it avoids. */
const GAP = 8;

const overlaps = (a: TownBox, b: TownBox) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Where each board goes, in order, as offsets from where it stands: clear of
 * `fixed` (the center, the post office, the billboard) and of the boards
 * placed before it, within the town's `width`. `gap` is in world pixels.
 */
export function townPlaceBoards(
  boards: readonly TownBoardRequest[],
  fixed: readonly TownBox[],
  width: number,
  gap: number,
) {
  const offsets = new Map<string, TownBoardOffset>();
  const placed: TownBox[] = [];
  for (const board of boards) {
    const box = ({ dx, dy }: TownBoardOffset): TownBox => ({
      x0: board.x - board.w / 2 + dx,
      x1: board.x + board.w / 2 + dx,
      y0: board.y - board.h + dy,
      y1: board.y + dy,
    });
    const blocks = [...fixed, ...placed];
    const own = Math.min(board.w, board.x1 - board.x0) / 3;
    const fits = (shifted: TownBox) =>
      shifted.x0 >= 0 &&
      shifted.x1 <= width &&
      Math.min(shifted.x1, board.x1) - Math.max(shifted.x0, board.x0) >=
        own - 0.01 &&
      !blocks.some((block) => overlaps(shifted, block));
    // Sideways: beside each thing in the way, the nearest first.
    const shifts = [
      0,
      ...blocks.flatMap((block) => [
        block.x0 - gap - (board.x + board.w / 2),
        block.x1 + gap - (board.x - board.w / 2),
      ]),
    ].sort((a, b) => Math.abs(a) - Math.abs(b));
    let offset: TownBoardOffset | undefined;
    for (const dx of shifts)
      if (fits(box({ dx, dy: 0 }))) {
        offset = { dx, dy: 0 };
        break;
      }
    if (!offset) {
      // Below the fixed things over its door, onto the street.
      const standing = box({ dx: 0, dy: 0 });
      const under = Math.max(
        standing.y0,
        ...fixed
          .filter((block) => overlaps(standing, block))
          .map((block) => block.y1 + gap),
      );
      offset = { dx: 0, dy: under - standing.y0 };
    }
    offsets.set(board.key, offset);
    placed.push(box(offset));
  }
  return offsets;
}

/** The town center's lot, the post office's and the billboard, in world pixels. */
export function townBoardObstacles(
  layout: TownLayout,
  /** The billboard's size in screen pixels; null when folded or unmeasured. */
  city: { w: number; h: number } | null,
  z: number,
): TownBox[] {
  const { center } = layout;
  const boxes: TownBox[] = [
    {
      x0: center.x * T,
      x1: (center.x + center.w) * T,
      y0: center.y * T,
      y1: center.street * T,
    },
  ];
  if (layout.formFactor !== "narrow") {
    const post = townPostReserve(townPostLotBeside(center));
    boxes.push({
      x0: post.x0 * T,
      x1: post.x1 * T,
      y0: post.y0 * T,
      y1: post.y1 * T,
    });
  }
  if (city) {
    const scale = townCityBoardScale(z);
    const mid = (center.x + center.w / 2) * T;
    const foot = center.y * T - TOWN_CITY_BOARD_GAP;
    boxes.push({
      x0: mid - (city.w * scale) / 2,
      x1: mid + (city.w * scale) / 2,
      y0: foot - city.h * scale,
      y1: foot,
    });
  }
  return boxes;
}

type Size = { w: number; h: number };
type BoardNode = Pick<HTMLElement, "offsetWidth" | "offsetHeight"> & {
  style: Pick<CSSStyleDeclaration, "translate">;
};

/**
 * The committed reception boards and the billboard, measured as they
 * resize, placed on every drawn frame.
 */
export class TownBoardPlacement {
  private readonly receptions = new Map<string, BoardNode>();
  private city: BoardNode | null = null;
  private readonly sizes = new Map<BoardNode, Size>();
  /** What each board was last moved by, so still frames write nothing. */
  private readonly written = new WeakMap<BoardNode, string>();
  private readonly observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const box = entry.borderBoxSize?.[0];
            this.sizes.set(entry.target as unknown as BoardNode, {
              w: box ? box.inlineSize : entry.contentRect.width,
              h: box ? box.blockSize : entry.contentRect.height,
            });
          }
          this.requestFrame();
        })
      : null;

  /** Asks the renderer for a frame when a board is added or resized. */
  constructor(
    private readonly renderer: {
      current: { invalidate(reason: string): void } | null;
    },
  ) {}

  private requestFrame() {
    this.renderer.current?.invalidate("board-size");
  }

  private watch(node: BoardNode) {
    this.observer?.observe(node as unknown as Element);
    this.requestFrame();
    return () => {
      this.observer?.unobserve(node as unknown as Element);
      this.sizes.delete(node);
    };
  }

  /** The billboard's ref; a folded sign is not registered. */
  readonly cityRef = (node: BoardNode | null) => {
    if (this.city) this.observer?.unobserve(this.city as unknown as Element);
    this.city = node;
    if (node) this.watch(node);
  };

  private readonly refs = new Map<string, (node: BoardNode | null) => void>();

  /**
   * A reception board's ref, the same one each render; an abandoned render
   * registers nothing.
   */
  receptionRef(hostKey: string) {
    const known = this.refs.get(hostKey);
    if (known) return known;
    let release: (() => void) | undefined;
    const ref = (node: BoardNode | null) => {
      release?.();
      release = undefined;
      if (!node) return;
      this.receptions.set(hostKey, node);
      const unwatch = this.watch(node);
      release = () => {
        unwatch();
        // A retiring ref cannot remove another committed node for this key.
        if (this.receptions.get(hostKey) === node)
          this.receptions.delete(hostKey);
      };
    };
    this.refs.set(hostKey, ref);
    return ref;
  }

  private size(node: BoardNode): Size {
    return (
      this.sizes.get(node) ?? { w: node.offsetWidth, h: node.offsetHeight }
    );
  }

  /** Place the boards for zoom `z` over `layout`. */
  place(z: number, layout: TownLayout) {
    if (!this.receptions.size) return;
    const boards: TownBoardRequest[] = [];
    const nodes = new Map<string, BoardNode>();
    for (const building of layout.buildings) {
      const node = this.receptions.get(building.hostKey);
      if (!node) continue;
      const { w, h } = this.size(node);
      nodes.set(building.hostKey, node);
      boards.push({
        key: building.hostKey,
        x: (building.entryX + 0.5) * T,
        y: building.y * T - TOWN_RECEPTION_LIFT,
        w: w / z,
        h: h / z,
        x0: building.x * T,
        x1: (building.x + building.w) * T,
      });
    }
    const offsets = townPlaceBoards(
      boards,
      townBoardObstacles(layout, this.city ? this.size(this.city) : null, z),
      layout.width * T,
      GAP / z,
    );
    for (const [key, { dx, dy }] of offsets) {
      const node = nodes.get(key)!;
      const translate =
        dx === 0 && dy === 0
          ? ""
          : `${Math.round(dx * 10) / 10}px ${Math.round(dy * 10) / 10}px`;
      if (this.written.get(node) === translate) continue;
      this.written.set(node, translate);
      node.style.translate = translate;
    }
  }
}
