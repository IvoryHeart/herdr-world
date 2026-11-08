import { expect, test } from "bun:test";
import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_STEP_LIMIT,
  TownStepStore,
  townStepWanted,
} from "./townStepStore";
import type { TownStep } from "./townSteps";

const step = (kind: TownStep["kind"]): TownStep => ({
  kind,
  since: 0,
  task: null,
});

test("only the bubble whose step changed is told", () => {
  const store = new TownStepStore();
  store.want(["a", "b"]);
  const told: string[] = [];
  store.subscribe("a", () => told.push("a"));
  store.subscribe("b", () => told.push("b"));
  store.set(
    new Map([
      ["a", step("edit")],
      ["b", step("test")],
    ]),
  );
  expect(told).toEqual(["a", "b"]);
  told.length = 0;
  store.set(
    new Map([
      ["a", step("edit")],
      ["b", step("read")],
    ]),
  );
  expect(told).toEqual(["b"]);
  told.length = 0;
  store.set(new Map([["a", step("edit")]]));
  expect(told).toEqual(["b"]);
  expect(store.get("b")).toBeUndefined();
});

test("glyph keys follow the agents with steps, and change only when they do", () => {
  const store = new TownStepStore();
  let told = 0;
  store.onGlyphs(() => told++);
  store.set(new Map([["a", step("edit")]]));
  const first = store.glyphKeys();
  expect([...first]).toEqual(["a"]);
  store.set(new Map([["a", step("test")]]));
  expect(store.glyphKeys()).toBe(first);
  expect(told).toBe(1);
});

test("an agent no longer wanted loses its step, and the wanted list is bounded", () => {
  const store = new TownStepStore();
  store.want(["a", "b"]);
  store.set(
    new Map([
      ["a", step("edit")],
      ["b", step("test")],
    ]),
  );
  let asked = 0;
  store.onWant(() => asked++);
  store.want(["b", "a"]);
  expect(asked).toBe(0);
  store.want(["b"]);
  expect(asked).toBe(1);
  expect(store.get("a")).toBeUndefined();
  expect(store.get("b")?.kind).toBe("test");
  store.want(Array.from({ length: 100 }, (_, index) => `k${index}`));
  expect(store.wantedKeys()).toHaveLength(TOWN_STEP_LIMIT);
});

test("Town wants working agents at desks on screen, nearest the middle first", () => {
  // A room of three desks in a row; the screen shows the first two.
  const room = {
    x: 0,
    y: 0,
    w: 15,
    h: 5,
    cells: [
      { x: 0, y: 0, deskKey: "d0" },
      { x: 5, y: 0, deskKey: "d1" },
      { x: 10, y: 0, deskKey: "d2" },
      { x: 10, y: 5, deskKey: null },
    ],
  };
  const agents: Record<string, string[]> = {
    d0: ["a0", "idle0"],
    d1: ["a1"],
    d2: ["a2"],
  };
  const wanted = townStepWanted(
    [room],
    { x0: 4 * T, y0: 0, x1: 9 * T, y1: 5 * T },
    (desk) => agents[desk] ?? [],
    (agent) => agent.startsWith("a"),
  );
  expect(wanted).toEqual(["a1", "a0"]);
  // A room off screen is not looked into.
  expect(
    townStepWanted(
      [{ ...room, x: 100 }],
      { x0: 0, y0: 0, x1: 9 * T, y1: 5 * T },
      () => {
        throw new Error("read a desk off screen");
      },
      () => true,
    ),
  ).toEqual([]);
});
