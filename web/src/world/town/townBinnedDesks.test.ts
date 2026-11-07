import { expect, test } from "bun:test";
import type { Graphics } from "pixi.js";
import {
  drawTownBinnedDesk,
  TOWN_BINNED_FADE_S,
  townBinnedDesks,
} from "./townBinnedDesks";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import type { TownModel } from "./townModel";

const DESK = "a/r0/t0";
const { layout } = layoutTown(
  {
    hosts: [{ key: "a", displayOrder: 0 }],
    rooms: [
      { key: "a/r0", hostKey: "a", order: 0, deskKeys: [DESK], deskSeats: [4] },
    ],
  },
  TOWN_SHAPES.phone,
);
const cell = layout.buildings[0]!.rooms[0]!.cells.find(
  (c) => c.deskKey === DESK,
)!;
// A team desk: four agents, one per seat.
const agents = ["w", "x", "y", "z"];
const model = {
  agentSeats: new Map(
    agents.map((key, seat) => [key, { deskKey: DESK, seat }]),
  ),
  desks: new Map([
    [DESK, { paneDevices: agents.map((agentKey) => ({ agentKey })) }],
  ]),
} as unknown as Pick<TownModel, "agentSeats" | "desks">;

test("only the binned agents' seats fade at a shared desk", () => {
  expect(townBinnedDesks(layout, model, new Set())).toEqual([]);
  const [desk] = townBinnedDesks(layout, model, new Set(["x", "y"]));
  expect(desk).toMatchObject({
    deskKey: DESK,
    hostKey: "a",
    roomKey: "a/r0",
    whole: false,
  });
  expect(desk!.rects.map((rect) => rect.key)).toEqual([
    `${DESK}#1`,
    `${DESK}#2`,
  ]);
  const X = (cell.x + 1) * T;
  const Y = cell.y * T;
  // The top right seat, then the bottom left one.
  expect(desk!.rects[0]).toMatchObject({ x: X + 39, y: Y + 2 });
  expect(desk!.rects[1]).toMatchObject({ x: X + 7, y: Y + 33 });
  // Above the desk's own sprites.
  expect(desk!.z).toBeGreaterThan(Y + 52);
});

test("a desk whose agents are all binned fades whole", () => {
  const [desk] = townBinnedDesks(layout, model, new Set(agents));
  expect(desk!.whole).toBe(true);
  expect(desk!.rects).toHaveLength(1);
  expect(desk!.rects[0]!.key).toBe(DESK);
  expect(desk!.rects[0]!.w).toBeGreaterThan(60);
});

test("a binned seat fades in, then crumbles; still with reduced motion", () => {
  const fills: number[] = [];
  const g = {
    clear: () => g,
    rect: () => g,
    fill: ({ alpha }: { alpha: number }) => {
      fills.push(alpha);
      return g;
    },
  } as unknown as Graphics;
  const [desk] = townBinnedDesks(layout, model, new Set(agents));
  const draw = (clock: number, still: boolean) => {
    fills.length = 0;
    const moving = drawTownBinnedDesk(
      g,
      desk!,
      "#3d7c77",
      clock,
      () => 0,
      still,
    );
    return { moving, veil: fills[0]!, crumbs: fills.length - 1 };
  };
  const start = draw(0, false);
  expect(start.veil).toBe(0);
  const half = draw(TOWN_BINNED_FADE_S / 2, false);
  const full = draw(TOWN_BINNED_FADE_S * 4, false);
  expect(half.veil).toBeGreaterThan(0);
  expect(full.veil).toBeGreaterThan(half.veil);
  expect(full.crumbs).toBeGreaterThan(0);
  expect(full.moving).toBe(true);
  // Reduced motion: faded at once, no crumbs, nothing to animate.
  const still = draw(0, true);
  expect(still).toEqual({ moving: false, veil: full.veil, crumbs: 0 });
});
