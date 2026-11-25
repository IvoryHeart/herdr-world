import { expect, test } from "bun:test";
import { townCenterContains } from "./townCenter";
import { townHitKey, townHitTest } from "./townHitTest";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  type TownInput,
  type TownLayout,
  type TownShape,
} from "./townLayout";
import type { TownModel } from "./townModel";
import { TownPlaces, townPlaceAt, townPlaceBoxes } from "./townPlaces";

const town = (spec: Record<string, number[]>): TownInput => ({
  hosts: Object.keys(spec).map((key, displayOrder) => ({ key, displayOrder })),
  rooms: Object.entries(spec).flatMap(([hostKey, rooms]) =>
    rooms.map((desks, order) => ({
      key: `${hostKey}/${order}`,
      hostKey,
      order,
      deskKeys: Array.from(
        { length: desks },
        (_, d) => `${hostKey}/${order}/${d}`,
      ),
    })),
  ),
});

const towns: [string, TownInput, TownShape][] = [
  ["one building, wide", town({ a: [1] }), TOWN_SHAPES.wide],
  [
    "two streets, wide",
    town({ a: [2], b: [1], c: [1], d: [1], e: [1] }),
    TOWN_SHAPES.wide,
  ],
  ["one building, portrait", town({ a: [1] }), TOWN_SHAPES.portrait],
  ["one building, phone", town({ a: [1] }), TOWN_SHAPES.phone],
  [
    "three buildings, phone",
    town({ a: [2], b: [1], c: [4] }),
    TOWN_SHAPES.phone,
  ],
];

const middle = (box: { x0: number; y0: number; x1: number; y1: number }) =>
  [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2] as const;

const hit = (
  layout: TownLayout,
  x: number,
  y: number,
  places?: (key: string) => boolean,
) =>
  townHitTest(
    {
      layout,
      model: { desks: new Map(), agents: new Map() } as unknown as TownModel,
      level: "room",
      roofAlpha: () => 1,
      standing: () => [],
      zoom: 1,
      places,
    },
    x,
    y,
  );

test.each(towns)(
  "each place's building is its own box, clear of hosts' buildings and the town center (%s)",
  (_, input, shape) => {
    const { layout } = layoutTown(input, shape);
    const boxes = townPlaceBoxes(layout);
    for (const [key, box] of boxes) {
      expect(box.x1 - box.x0).toBeGreaterThan(2 * T);
      expect(box.y1 - box.y0).toBeGreaterThan(2 * T);
      const [x, y] = middle(box);
      expect(townPlaceAt(layout, x, y)).toBe(key);
      expect(townCenterContains(layout.center, T, x, y)).toBe(false);
      for (const building of layout.buildings)
        expect(
          box.x1 <= building.x * T ||
            box.x0 >= (building.x + building.w) * T ||
            box.y1 <= building.y * T ||
            box.y0 >= (building.y + building.h) * T,
        ).toBe(true);
      for (const [other, otherBox] of boxes)
        if (other !== key)
          expect(
            box.x1 <= otherBox.x0 ||
              box.x0 >= otherBox.x1 ||
              box.y1 <= otherBox.y0 ||
              box.y0 >= otherBox.y1,
          ).toBe(true);
    }
  },
);

test("a wide town and a phone's both have all five buildings (#1351)", () => {
  const wide = townPlaceBoxes(
    layoutTown(town({ a: [1] }), TOWN_SHAPES.wide).layout,
  );
  expect(wide.map(([key]) => key).sort()).toEqual([
    "apartments",
    "library",
    "observatory",
    "post",
    "warehouse",
  ]);
  for (const shape of [TOWN_SHAPES.phone, TOWN_SHAPES.portrait])
    expect(
      townPlaceBoxes(layoutTown(town({ a: [1] }), shape).layout)
        .map(([key]) => key)
        .sort(),
    ).toEqual(["apartments", "library", "observatory", "post", "warehouse"]);
});

test("a building is a place target only while its place opens something", () => {
  const { layout } = layoutTown(town({ a: [1] }), TOWN_SHAPES.wide);
  const [, box] = townPlaceBoxes(layout).find(([key]) => key === "post")!;
  const [x, y] = middle(box);
  // Without the places port (a town drawn alone) the house is plain lawn.
  expect(hit(layout, x, y)).toBeNull();
  expect(hit(layout, x, y, () => false)).toBeNull();
  const placeHit = hit(layout, x, y, (key) => key === "post");
  expect(placeHit).toEqual({ kind: "place", key: "post" });
  expect(townHitKey(placeHit)).toBeNull();
  // The town center keeps its own target.
  const { center } = layout;
  expect(
    hit(
      layout,
      (center.x + center.w / 2) * T,
      (center.y + center.h - 3) * T,
      () => true,
    ),
  ).toEqual({ kind: "center" });
});

test("a place opens what its component registered, and hover marks only its sign", () => {
  const places = new TownPlaces();
  const opened: string[] = [];
  const release = places.register("library", () => opened.push("library"));
  expect(places.opens("library")).toBe(true);
  expect(places.opens("post")).toBe(false);
  expect(places.open("post")).toBe(false);
  expect(places.open("library")).toBe(true);
  expect(opened).toEqual(["library"]);
  // A later registration survives an earlier one's release.
  const later = () => opened.push("later");
  places.register("library", later);
  release();
  expect(places.opens("library")).toBe(true);

  const sign = (place: string) => {
    const attributes = new Set<string>();
    return {
      dataset: { townPlace: place },
      attributes,
      toggleAttribute: (name: string, on: boolean) =>
        on ? attributes.add(name) : attributes.delete(name),
    };
  };
  const signs = [sign("library"), sign("post")];
  const root = {
    querySelectorAll: () => signs,
  } as unknown as ParentNode;
  places.hover("library", root);
  expect(signs.map((s) => s.attributes.has("data-place-hovered"))).toEqual([
    true,
    false,
  ]);
  places.hover(null, root);
  expect(signs.some((s) => s.attributes.has("data-place-hovered"))).toBe(false);
});
