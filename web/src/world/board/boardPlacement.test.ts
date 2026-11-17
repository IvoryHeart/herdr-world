import { describe, expect, test } from "bun:test";
import { fixtureHost, fixtureWorld, type FixtureSpace } from "./boardFixture";
import { projectBoard, type BoardModel } from "./boardModel";
import {
  DEFAULT_SIZE,
  emptyLayout,
  overlaps,
  cloneLayout,
  makeShelfRoom,
  placeNew,
  positions,
  rectAt,
  clearSpots,
  tidy,
  type SizeOf,
  type BoardLayout,
} from "./boardPlacement";
import {
  SHELF_BAND_PAD,
  shelfBand,
  shelfKeys,
  shelfOffsets,
} from "./boardPinFirst";

const spaces = (tabCounts: number[]): FixtureSpace[] =>
  tabCounts.map((count, s) => ({
    label: `space ${s}`,
    tabs: Array.from({ length: count }, (_, t) => ({
      label: `tab ${t}`,
      panes: [["idle"]],
    })),
  }));

function overlapping(
  model: BoardModel,
  layout: BoardLayout,
  sizeOf: SizeOf = (_key, kind) => DEFAULT_SIZE[kind],
) {
  const at = positions(model, layout);
  const rects = [...at].map(([key, point]) =>
    rectAt(
      sizeOf(key, model.workspaceByKey.has(key) ? "workspace" : "tab"),
      point,
    ),
  );
  let count = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (overlaps(rects[i]!, rects[j]!, 0)) count++;
  return count;
}

describe("Board placement", () => {
  test("a first layout places every card without overlaps, on desktop and phone", () => {
    const model = projectBoard(
      fixtureWorld([
        fixtureHost("alpha", spaces([4, 3, 2])),
        fixtureHost("beta", spaces([3, 5])),
      ]),
    );
    for (const phone of [false, true]) {
      const layout = placeNew(model, emptyLayout(), { phone });
      expect(positions(model, layout).size).toBe(
        model.workspaces.length + model.tabs.length,
      );
      expect(overlapping(model, layout)).toBe(0);
    }
  });

  test("the owner's maximum scale fits without overlaps", () => {
    const hosts = ["alpha", "beta", "gamma"].map((name) =>
      fixtureHost(name, spaces(Array.from({ length: 8 }, () => 15))),
    );
    const model = projectBoard(fixtureWorld(hosts));
    const layout = placeNew(model, emptyLayout());
    expect(positions(model, layout).size).toBe(3 * 8 + 3 * 8 * 15);
    expect(overlapping(model, layout)).toBe(0);
  });

  test("a new tab takes free space and no existing card moves", () => {
    const before = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([3, 2]))]),
    );
    const first = placeNew(before, emptyLayout());
    const was = positions(before, first);
    const after = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([4, 2]))]),
    );
    const second = placeNew(after, first);
    const now = positions(after, second);
    for (const [key, point] of was) expect(now.get(key)).toEqual(point);
    expect(now.has("alpha:w1:t4")).toBe(true);
    expect(overlapping(after, second)).toBe(0);
  });

  test("a closed tab leaves every other card where it was", () => {
    const before = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([4]))]),
    );
    const layout = placeNew(before, emptyLayout());
    const was = positions(before, layout);
    const after = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([3]))]),
    );
    const now = positions(after, placeNew(after, layout));
    for (const [key, point] of now) expect(point).toEqual(was.get(key)!);
  });

  test("a pinned tab sits on its workspace's shelf, above it, and moves with it", () => {
    const model = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([2]))]),
    );
    const layout = placeNew(model, emptyLayout());
    layout.pinned.set("alpha:w1:t2", { x: 900, y: 900 });
    layout.offsets.set("alpha:w1", { x: 300, y: 0 });
    const at = positions(model, layout);
    const ws = at.get("alpha:w1")!;
    const pin = at.get("alpha:w1:t2")!;
    expect(ws).toEqual({ x: 300, y: 0 });
    expect(pin.x).toBe(ws.x);
    expect(pin.y).toBeLessThan(ws.y);
    // The saved point is not its place: it follows its workspace.
    layout.offsets.set("alpha:w1", { x: -400, y: 200 });
    const moved = positions(model, layout);
    expect(moved.get("alpha:w1:t2")).toEqual({
      x: pin.x - 700,
      y: pin.y + 200,
    });
  });

  test("pinned tabs fill the shelf in tab order, in rows of three, the last row nearest", () => {
    const keys = ["t1", "t2", "t3", "t4"];
    const shelf = shelfOffsets(keys, { w: 200, h: 80 }, () => ({
      w: 100,
      h: 60,
    }));
    const [t1, t2, t3, t4] = keys.map((key) => shelf.get(key)!);
    // The first row reads left to right, above the second.
    expect(t1!.y).toBe(t2!.y);
    expect(t2!.y).toBe(t3!.y);
    expect(t1!.x).toBeLessThan(t2!.x);
    expect(t2!.x).toBeLessThan(t3!.x);
    expect(t4!.y).toBeGreaterThan(t1!.y);
    expect(t4!.x).toBe(0);
    // The last row sits clear of the workspace card.
    expect(t4!.y + 30).toBeLessThan(-40);
    expect(shelfKeys(["a", "b", "c"], new Set(["c", "a"]))).toEqual(["a", "c"]);
  });

  test("the pinned band wraps a shelf's cards with a margin", () => {
    expect(shelfBand([])).toBeNull();
    const band = shelfBand([
      { at: { x: 0, y: 0 }, size: { w: 100, h: 60 } },
      { at: { x: 132, y: 0 }, size: { w: 100, h: 60 } },
    ])!;
    expect(band.x0).toBe(-50 - SHELF_BAND_PAD);
    expect(band.x1).toBe(182 + SHELF_BAND_PAD);
    expect(band.y0).toBe(-30 - SHELF_BAND_PAD);
  });

  test("pinning moves an unpinned card off the shelf; unpinning gives the card free space", () => {
    const model = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([3]))]),
    );
    const layout = placeNew(model, emptyLayout());
    const ws = positions(model, layout).get("alpha:w1")!;
    // An unpinned card stands just where the shelf will be.
    layout.offsets.set("alpha:w1:t1", { x: 0, y: -120 });
    layout.pinned.set("alpha:w1:t3", { x: 0, y: 0 });
    const shelved = makeShelfRoom(model, layout, "alpha:w1");
    expect(overlapping(model, shelved)).toBe(0);
    const pin = positions(model, shelved).get("alpha:w1:t3")!;
    expect(pin.x).toBe(ws.x);
    expect(pin.y).toBeLessThan(ws.y);
    // Unpinned with no saved offset, it takes free space like a new card.
    const unpinned = cloneLayout(shelved);
    unpinned.pinned.delete("alpha:w1:t3");
    unpinned.offsets.delete("alpha:w1:t3");
    const after = makeShelfRoom(model, unpinned, "alpha:w1");
    expect(after.offsets.has("alpha:w1:t3")).toBe(true);
    expect(overlapping(model, after)).toBe(0);
  });

  test("tidying a workspace rearranges only its unpinned tabs, around its shelf", () => {
    const model = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([3, 3]))]),
    );
    const layout = placeNew(model, emptyLayout());
    layout.offsets.set("alpha:w1:t1", { x: 2000, y: 2000 });
    layout.pinned.set("alpha:w1:t2", { x: -800, y: -800 });
    const before = positions(model, layout);
    const tidied = tidy(model, layout, { workspaceKey: "alpha:w1" });
    const after = positions(model, tidied);
    expect(after.get("alpha:w1:t1")).not.toEqual(before.get("alpha:w1:t1"));
    expect(after.get("alpha:w1:t2")).toEqual(before.get("alpha:w1:t2"));
    for (const key of ["alpha:w2", "alpha:w2:t1", "alpha:w2:t2", "alpha:w2:t3"])
      expect(after.get(key)).toEqual(before.get(key));
    expect(overlapping(model, tidied)).toBe(0);
    // The previous layout is untouched, so Undo can restore it.
    expect(positions(model, layout).get("alpha:w1:t1")).toEqual(
      before.get("alpha:w1:t1"),
    );
  });

  test("tidying the whole board keeps pinned cards on their shelves and removes overlaps", () => {
    const model = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([3, 3]))]),
    );
    const messy = placeNew(model, emptyLayout());
    for (const key of messy.offsets.keys())
      messy.offsets.set(key, { x: 0, y: 0 });
    messy.pinned.set("alpha:w2:t3", { x: 5000, y: 0 });
    const tidied = tidy(model, messy);
    const at = positions(model, tidied);
    const ws = at.get("alpha:w2")!;
    expect(at.get("alpha:w2:t3")!.x).toBe(ws.x);
    expect(at.get("alpha:w2:t3")!.y).toBeLessThan(ws.y);
    expect(overlapping(model, tidied)).toBe(0);
  });

  test("tidying the whole board uses real card sizes, so tall tabs and many hosts never overlap", () => {
    const model = projectBoard(
      fixtureWorld([
        fixtureHost("alpha", spaces([9, 2, 6, 1, 4])),
        fixtureHost("beta", spaces([3, 8])),
      ]),
    );
    // Tabs with pane rows and task lines are much taller than the default.
    const sizeOf: SizeOf = (key, kind) =>
      kind === "workspace"
        ? { w: 236, h: 84 }
        : { w: 210 + (key.length % 3) * 30, h: 66 + (key.length % 4) * 45 };
    for (const phone of [false, true]) {
      const tidied = tidy(model, placeNew(model, emptyLayout()), {
        phone,
        sizeOf,
      });
      expect(overlapping(model, tidied, sizeOf)).toBe(0);
    }
  });

  test("clearing notes moves only those on a card, to the nearest free spot", () => {
    const card = rectAt({ w: 200, h: 80 }, { x: 0, y: 0 });
    const spots = clearSpots(
      [
        { key: "on", size: { w: 120, h: 60 }, at: { x: 10, y: 5 } },
        { key: "off", size: { w: 120, h: 60 }, at: { x: 600, y: 0 } },
      ],
      [card],
    );
    expect(spots.get("off")).toEqual({ x: 600, y: 0 });
    expect(overlaps(rectAt({ w: 120, h: 60 }, spots.get("on")!), card)).toBe(
      false,
    );
  });
});
