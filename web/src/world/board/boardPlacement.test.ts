import { describe, expect, test } from "bun:test";
import { fixtureHost, fixtureWorld, type FixtureSpace } from "./boardFixture";
import { projectBoard, type BoardModel } from "./boardModel";
import {
  DEFAULT_SIZE,
  emptyLayout,
  overlaps,
  placeNew,
  positions,
  rectAt,
  tidy,
  type BoardLayout,
} from "./boardPlacement";

const spaces = (tabCounts: number[]): FixtureSpace[] =>
  tabCounts.map((count, s) => ({
    label: `space ${s}`,
    tabs: Array.from({ length: count }, (_, t) => ({
      label: `tab ${t}`,
      panes: [["idle"]],
    })),
  }));

function overlapping(model: BoardModel, layout: BoardLayout) {
  const at = positions(model, layout);
  const rects = [...at].map(([key, point]) =>
    rectAt(
      DEFAULT_SIZE[model.workspaceByKey.has(key) ? "workspace" : "tab"],
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

  test("a pinned card keeps its board position when its workspace moves", () => {
    const model = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([2]))]),
    );
    const layout = placeNew(model, emptyLayout());
    layout.pinned.set("alpha:w1:t1", { x: 900, y: 900 });
    layout.offsets.set("alpha:w1", { x: 300, y: 0 });
    const at = positions(model, layout);
    expect(at.get("alpha:w1:t1")).toEqual({ x: 900, y: 900 });
    expect(at.get("alpha:w1")).toEqual({ x: 300, y: 0 });
  });

  test("tidying a workspace rearranges only its unpinned tabs", () => {
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
    expect(after.get("alpha:w1:t2")).toEqual({ x: -800, y: -800 });
    for (const key of ["alpha:w2", "alpha:w2:t1", "alpha:w2:t2", "alpha:w2:t3"])
      expect(after.get(key)).toEqual(before.get(key));
    expect(overlapping(model, tidied)).toBe(0);
    // The previous layout is untouched, so Undo can restore it.
    expect(positions(model, layout).get("alpha:w1:t1")).toEqual(
      before.get("alpha:w1:t1"),
    );
  });

  test("tidying the whole board keeps pinned cards and removes overlaps", () => {
    const model = projectBoard(
      fixtureWorld([fixtureHost("alpha", spaces([3, 3]))]),
    );
    const messy = placeNew(model, emptyLayout());
    for (const key of messy.offsets.keys())
      messy.offsets.set(key, { x: 0, y: 0 });
    messy.pinned.set("alpha:w2:t3", { x: 5000, y: 0 });
    const tidied = tidy(model, messy);
    expect(positions(model, tidied).get("alpha:w2:t3")).toEqual({
      x: 5000,
      y: 0,
    });
    expect(overlapping(model, tidied)).toBe(0);
  });
});
