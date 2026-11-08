import { expect, test } from "bun:test";
import {
  TOWN_EDGE_MARGIN,
  townCompass,
  townEdgeArrowLabel,
  townEdgeArrows,
  townEdgeArrowsEqual,
  type TownEdgeCamera,
  type TownEdgeTarget,
} from "./townEdgeArrows";

// A 1000×600 view with no chrome, centred on the world origin at zoom 1:
// the visible map spans world x -500..500 and y -300..300.
const camera: TownEdgeCamera = {
  x: 0,
  y: 0,
  z: 1,
  viewport: {
    width: 1000,
    height: 600,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
  },
};

const at = (
  key: string,
  x: number,
  y: number,
  mark: TownEdgeTarget["mark"] = "needs",
  hostKey = "north",
): TownEdgeTarget => ({ key, mark, hostKey, x, y });

test("there are no arrows at town and building zoom, where all shows", () => {
  const targets = [at("far", 4000, 0)];
  expect(townEdgeArrows(targets, camera, "town")).toEqual([]);
  expect(townEdgeArrows(targets, camera, "overview")).toEqual([]);
  expect(townEdgeArrows(targets, camera, "room")).toHaveLength(1);
  expect(townEdgeArrows(targets, camera, "desk")).toHaveLength(1);
});

test("only agents outside the visible map get arrows, on the edge facing them", () => {
  const arrows = townEdgeArrows(
    [at("seen", 100, 50), at("east", 2000, 0, "asks", "east-host")],
    camera,
    "room",
  );
  expect(arrows).toHaveLength(1);
  const [arrow] = arrows;
  expect(arrow!.keys).toEqual(["east"]);
  expect(arrow!.mark).toBe("asks");
  expect(arrow!.compass).toBe("east");
  expect(arrow!.x).toBeCloseTo(1000 - TOWN_EDGE_MARGIN);
  expect(arrow!.y).toBeCloseTo(300);
  // Above the view: the top edge, pointing north.
  const [north] = townEdgeArrows([at("up", 0, -900)], camera, "room");
  expect(north!.compass).toBe("north");
  expect(north!.y).toBeCloseTo(TOWN_EDGE_MARGIN);
});

test("the chrome's insets are outside the visible map", () => {
  const covered: TownEdgeCamera = {
    ...camera,
    viewport: {
      ...camera.viewport,
      inset: { top: 16, right: 72, bottom: 16, left: 16 },
    },
  };
  // On the canvas but under the zoom group on the right.
  const arrows = townEdgeArrows([at("under", 470, 0)], covered, "desk");
  expect(arrows).toHaveLength(1);
  expect(arrows[0]!.x).toBeCloseTo(1000 - 72 - TOWN_EDGE_MARGIN);
  // A camera that moves to the agent makes its arrow go away.
  expect(
    townEdgeArrows([at("under", 470, 0)], { ...covered, x: 300 }, "desk"),
  ).toEqual([]);
});

test("arrows pointing the same way merge with a count, most urgent first", () => {
  const arrows = townEdgeArrows(
    [
      at("done", 3000, 10, "done", "a"),
      at("ask", 3000, -10, "asks", "b"),
      at("blocked", 3000, 0, "needs", "c"),
      at("west", -3000, 0, "needs", "d"),
    ],
    camera,
    "room",
  );
  expect(arrows).toHaveLength(2);
  const east = arrows.find((arrow) => arrow.compass === "east")!;
  expect(east.count).toBe(3);
  expect(east.mark).toBe("needs");
  expect(east.counts).toEqual({ needs: 1, asks: 1, done: 1 });
  expect(east.keys).toEqual(["blocked", "ask", "done"]);
  expect(east.hostKeys).toEqual(["c", "b", "a"]);
  expect(arrows.find((arrow) => arrow.compass === "west")!.count).toBe(1);
});

test("one building's agents merge when near on the edge, not across the view", () => {
  // About 90 px apart along the top edge: two buildings stay two arrows...
  const apart = [at("one", -150, -900, "needs", "x"), at("two", 150, -900)];
  expect(townEdgeArrows(apart, camera, "room")).toHaveLength(2);
  // ...one building merges into one arrow.
  const one = [at("one", -150, -900), at("two", 150, -900)];
  const merged = townEdgeArrows(one, camera, "room");
  expect(merged).toHaveLength(1);
  expect(merged[0]!.count).toBe(2);
  // Its agents on opposite sides of the view stay two arrows.
  const across = [at("left", -3000, 0), at("right", 3000, 0)];
  expect(townEdgeArrows(across, camera, "room")).toHaveLength(2);
});

test("a merged arrow's tap goes to its nearest most urgent agent", () => {
  const [arrow] = townEdgeArrows(
    [at("far", 9000, 0), at("near", 1500, 0), at("done", 1200, 0, "done")],
    camera,
    "room",
  );
  expect(arrow!.keys).toEqual(["near", "far", "done"]);
});

test("arrows keep out of the Town board and the zoom group", () => {
  const board = { left: 0, top: 0, right: 240, bottom: 140 };
  // Up and to the left: the arrow would sit under the board.
  const [plain] = townEdgeArrows([at("nw", -3000, -1700)], camera, "room");
  expect(plain!.x).toBeLessThan(board.right);
  expect(plain!.y).toBeLessThan(board.bottom);
  const [moved] = townEdgeArrows([at("nw", -3000, -1700)], camera, "room", [
    board,
  ]);
  const inside =
    moved!.x + TOWN_EDGE_MARGIN > board.left &&
    moved!.x - TOWN_EDGE_MARGIN < board.right &&
    moved!.y + TOWN_EDGE_MARGIN > board.top &&
    moved!.y - TOWN_EDGE_MARGIN < board.bottom;
  expect(inside).toBe(false);
});

test("an arrow names what waits, where, and the way", () => {
  const [arrow] = townEdgeArrows(
    [at("a", 0, -900), at("b", 20, -900), at("c", 40, -900)],
    camera,
    "room",
  );
  expect(townEdgeArrowLabel(arrow!, (key) => `${key} building`)).toBe(
    "3 need you in north building, to the north, go there",
  );
  expect(
    townEdgeArrowLabel(
      {
        counts: { needs: 1, asks: 2, done: 1 },
        hostKeys: ["alpha", "beta"],
        compass: "south-west",
      },
      (key) => key,
    ),
  ).toBe(
    "1 needs you, 2 ask you and 1 is done in alpha and beta, to the south-west, go there",
  );
});

test("compass words follow screen directions", () => {
  expect(townCompass(0)).toBe("east");
  expect(townCompass(Math.PI / 2)).toBe("south");
  expect(townCompass(-Math.PI / 2)).toBe("north");
  expect(townCompass(Math.PI)).toBe("west");
  expect(townCompass(-Math.PI / 4)).toBe("north-east");
});

test("arrow lists compare equal while they draw the same", () => {
  const a = townEdgeArrows([at("e", 3000, 0)], camera, "room");
  const b = townEdgeArrows([at("e", 3000, 0.1)], camera, "room");
  const c = townEdgeArrows([at("e", 3000, 0)], { ...camera, y: 200 }, "room");
  expect(townEdgeArrowsEqual(a, b)).toBe(true);
  expect(townEdgeArrowsEqual(a, c)).toBe(false);
});
