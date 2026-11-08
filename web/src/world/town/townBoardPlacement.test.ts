import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOWN_CITY_BOARD_GAP,
  TOWN_CITY_BOARD_SCALE,
  townCityBoardScale,
} from "./townCenter";
import {
  layoutTown,
  TOWN_TILE as T,
  townShapeFor,
  type TownLayout,
} from "./townLayout";
import { townModelFromProjection } from "./townModel";
import {
  TOWN_RECEPTION_LIFT,
  TownBoardPlacement,
  townBoardObstacles,
  townPlaceBoards,
  type TownBox,
} from "./townBoardPlacement";
import { town, working } from "./scene/townScene.fixture";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownCamera } from "./townCamera";
import { townScaleConnections } from "./townScaleScene";
import { buildWorldObject } from "../worldObject";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";

const rooms = { a: working(4), b: working(3), c: working(2), d: working(4) };

/** `?scene=town-scale`: three hosts of eight rooms each. */
const scale = () => {
  const hosts = townScaleConnections();
  return projectWorldOffice(
    buildWorldObject(hosts, hosts[0]!.connectionId),
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
};

function layoutOf(
  hosts: number | "scale",
  size = { width: 1512, height: 982 },
) {
  const projection =
    hosts === "scale"
      ? scale()
      : town(
          Object.fromEntries(
            Array.from({ length: hosts }, (_, i) => [`h${i}`, rooms]),
          ),
        );
  return layoutTown(
    townModelFromProjection(projection).input,
    townShapeFor(size.width, size.height),
    new Map(),
    new Map(),
  ).layout;
}

const overlaps = (a: TownBox, b: TownBox) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A fake board node of a screen size, as a drawn reception board. */
function node(w: number, h: number) {
  return { offsetWidth: w, offsetHeight: h, style: { translate: "" } };
}

/** Place boards of a screen size at zoom z; their world boxes, by host. */
function placeAt(
  layout: TownLayout,
  z: number,
  board = { w: 260, h: 220 },
  city = { w: 240, h: 96 },
) {
  const placement = new TownBoardPlacement({ current: null });
  const nodes = layout.buildings.map((building) => {
    const n = node(board.w, board.h);
    placement.receptionRef(building.hostKey)(n);
    return n;
  });
  if (layout.formFactor !== "narrow") placement.cityRef(node(city.w, city.h));
  placement.place(z, layout);
  const boxes = layout.buildings.map((building, index) => {
    const [dx = 0, dy = 0] = nodes[index]!.style.translate
      ? nodes[index]!.style.translate.split(" ").map(parseFloat)
      : [];
    const x = (building.entryX + 0.5) * T + dx;
    const y = building.y * T - TOWN_RECEPTION_LIFT + dy;
    return {
      x0: x - board.w / z / 2,
      x1: x + board.w / z / 2,
      y0: y - board.h / z,
      y1: y,
    };
  });
  return {
    boxes,
    obstacles: townBoardObstacles(
      layout,
      layout.formFactor === "narrow" ? null : city,
      z,
    ),
  };
}

test("no reception board covers the town center, the post office, the billboard or another board", () => {
  for (const [hosts, zooms] of [
    // The owner's two buildings; the scale scene's three.
    [2, [0.45, 0.6, 0.73, 1, 1.3]],
    [3, [0.45, 0.53, 0.75, 1]],
    [1, [0.5, 0.73, 1]],
  ] as const)
    for (const z of zooms) {
      const layout = layoutOf(hosts);
      const { boxes, obstacles } = placeAt(layout, z);
      for (const [index, box] of boxes.entries()) {
        for (const obstacle of obstacles)
          expect(overlaps(box, obstacle)).toBe(false);
        for (const other of boxes.slice(index + 1))
          expect(overlaps(box, other)).toBe(false);
        // Each stays over its own building, within the town.
        const building = layout.buildings[index]!;
        const mid = (box.x0 + box.x1) / 2;
        expect(box.x0).toBeGreaterThanOrEqual(0);
        expect(box.x1).toBeLessThanOrEqual(layout.width * T);
        expect(
          Math.min(box.x1, (building.x + building.w) * T) -
            Math.max(box.x0, building.x * T),
        ).toBeGreaterThan(0);
        expect(Number.isFinite(mid)).toBe(true);
      }
    }
});

test("a board clear of everything stays over its front door", () => {
  const offsets = townPlaceBoards(
    [{ key: "a", x: 500, y: 400, w: 200, h: 100, x0: 300, x1: 700 }],
    [{ x0: 0, x1: 100, y0: 0, y1: 300 }],
    1000,
    8,
  );
  expect(offsets.get("a")).toEqual({ dx: 0, dy: 0 });
});

test("a board slides the least it can, keeping a third over its building", () => {
  const center: TownBox = { x0: 520, x1: 900, y0: 0, y1: 300 };
  // Its right edge would cross the center's left wall by 80: it slides left.
  const left = townPlaceBoards(
    [{ key: "a", x: 500, y: 400, w: 200, h: 200, x0: 300, x1: 700 }],
    [center],
    2000,
    8,
  );
  expect(left.get("a")).toEqual({ dx: -88, dy: 0 });
  // A board under the middle of the center, with no room beside it within
  // its building, hangs under the center's front steps instead.
  const under = townPlaceBoards(
    [{ key: "b", x: 700, y: 400, w: 200, h: 200, x0: 560, x1: 860 }],
    [center],
    2000,
    8,
  );
  expect(under.get("b")).toEqual({ dx: 0, dy: 300 + 8 - 200 });
});

test("a board with no room beside it hangs below the boards placed before it", () => {
  // The center covers both doors and neither board can slide off it within
  // its building: both hang lower, the second under the first.
  const offsets = townPlaceBoards(
    [
      { key: "a", x: 500, y: 400, w: 200, h: 200, x0: 420, x1: 580 },
      { key: "b", x: 560, y: 400, w: 200, h: 200, x0: 480, x1: 640 },
    ],
    [{ x0: 0, x1: 2000, y0: 0, y1: 300 }],
    2000,
    8,
  );
  const box = (x: number, key: string) => {
    const { dx, dy } = offsets.get(key)!;
    return { x0: x - 100 + dx, x1: x + 100 + dx, y0: 200 + dy, y1: 400 + dy };
  };
  expect(offsets.get("a")).toEqual({ dx: 0, dy: 108 });
  expect(overlaps(box(500, "a"), box(560, "b"))).toBe(false);
  expect(box(560, "b").y0).toBeGreaterThanOrEqual(box(500, "a").y1);
});

test("the first view keeps tall reception boards whole and apart", () => {
  for (const [size, hosts, board] of [
    // The reviews' cases: six-visitor boards in the scale scene.
    [{ width: 1280, height: 800 }, "scale", { w: 366, h: 170 }],
    [{ width: 1440, height: 700 }, "scale", { w: 390, h: 220 }],
    [{ width: 1440, height: 700 }, 3, { w: 390, h: 220 }],
    [{ width: 1512, height: 982 }, 2, { w: 390, h: 220 }],
    [{ width: 1280, height: 800 }, 2, { w: 260, h: 120 }],
  ] as const) {
    const layout = layoutOf(hosts, size);
    const viewport = townViewport(size.width, size.height, {
      left: 0,
      right: 0,
    });
    const camera = new TownCamera();
    camera.viewport = viewport;
    // Town opens before the boards are measured; at home, it frames them
    // once they are.
    const view = new TownSceneCamera(new Map(), () => {});
    view.attach(camera, layout, viewport);
    expect(view.atHome()).toBe(true);
    view.boardsResized(
      new Map(layout.buildings.map((building) => [building.hostKey, board.h])),
    );
    expect(view.atHome()).toBe(true);
    const { boxes, obstacles } = placeAt(layout, camera.z, board);
    for (const [index, box] of boxes.entries()) {
      for (const obstacle of obstacles)
        expect(overlaps(box, obstacle)).toBe(false);
      for (const other of boxes.slice(index + 1))
        expect(overlaps(box, other)).toBe(false);
      // Its header on screen, its foot too.
      expect(camera.toScreen(0, box.y0).y).toBeGreaterThanOrEqual(-0.01);
      expect(camera.toScreen(0, box.y1).y).toBeLessThanOrEqual(size.height);
    }
  }
});

test("boards that would meet keep apart, the later one moving", () => {
  const offsets = townPlaceBoards(
    [
      { key: "a", x: 300, y: 400, w: 300, h: 100, x0: 0, x1: 500 },
      { key: "b", x: 560, y: 400, w: 300, h: 100, x0: 450, x1: 1000 },
    ],
    [],
    1000,
    8,
  );
  expect(offsets.get("a")).toEqual({ dx: 0, dy: 0 });
  // a ends at 450; b starts at 410, so it moves 48 right.
  expect(offsets.get("b")).toEqual({ dx: 48, dy: 0 });
});

test("the billboard's scale in code and CSS agree", () => {
  const css = readFileSync(join(import.meta.dir, "townExpenses.css"), "utf8");
  expect(css).toContain(
    `scale(clamp(${TOWN_CITY_BOARD_SCALE.min}, var(--iz), ${TOWN_CITY_BOARD_SCALE.max}))`,
  );
  expect(townCityBoardScale(0.2)).toBe(TOWN_CITY_BOARD_SCALE.max);
  expect(townCityBoardScale(0.8)).toBeCloseTo(1.25);
});

test("a wide town keeps lawn above its center for the billboard at its largest", () => {
  const wide = layoutOf(2);
  const boxes = townBoardObstacles(wide, { w: 240, h: 104 }, 0.1);
  const city = boxes[boxes.length - 1]!;
  expect(city.y1).toBe(wide.center.y * T - TOWN_CITY_BOARD_GAP);
  expect(city.y0).toBeGreaterThanOrEqual(0);
  // A phone folds the billboard into the center's corner: no lawn above.
  expect(layoutOf(2, { width: 390, height: 844 }).center.y).toBe(2);
});
