import { expect, test } from "bun:test";
import { usageFixture } from "../usage/usageFixture";
import { townBusRoute } from "./townBus";
import { townLandscape } from "./townLandscape";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  TownGround,
  type TownInput,
  type TownShape,
} from "./townLayout";
import { townResetTime } from "./townLimits";
import {
  TOWN_OBSERVATORY_WINDOWS,
  townObservatory,
  townObservatoryCellText,
  townObservatoryFrom,
  townObservatoryLit,
  townObservatoryLot,
  townObservatoryReserve,
  townObservatorySpoken,
  townObservatoryWorking,
} from "./townObservatoryModel";
import { townPostLotBeside, townPostReserve } from "./townPostLot";
import { townLibraryLot, townLibraryReserve } from "./townLibraryLot";
import { townHarbourLot } from "./townHarbour";
import { townHarbourReserve } from "./townHarbourLot";
import { townPlaceBoxes } from "./townPlaces";

const NOW = Date.UTC(2026, 10, 18, 12);
const HOUR = 3_600_000;
const runs = (mode: "busy" | "reached" | "empty") =>
  usageFixture(NOW, mode, { group_by: "run", window: "7d" });

test("the sign shows each harness's 5 h and week used, reset times and who is at work", () => {
  const observatory = townObservatoryFrom(runs("busy"), new Map(), NOW);
  if (observatory.status !== "ready") throw new Error("expected a reading");
  expect(
    observatory.dials.map((dial) => [
      dial.name,
      dial.atWork,
      dial.cells.map(townObservatoryCellText),
    ]),
  ).toEqual([
    [
      "Claude",
      2,
      [
        `40% · ${townResetTime(NOW + 2 * HOUR)}`,
        `71% · ${townResetTime(NOW + 72 * HOUR)}`,
      ],
    ],
    [
      "Codex",
      1,
      [
        `4% · ${townResetTime(NOW + 4.7 * HOUR)}`,
        `18% · ${townResetTime(NOW + 48 * HOUR)}`,
      ],
    ],
    // A harness World reads no budget of, at work: shown, with no reading.
    ["Cursor", 1, ["no reading", "no reading"]],
  ]);
  // The live runs light the windows: Claude's two, Codex's one, Cursor's one.
  expect(townObservatoryLit(observatory.atWork)).toEqual({
    lit: ["claude", "claude", "codex", "cursor"],
    more: 0,
  });
  expect(townObservatorySpoken(observatory)).toStartWith(
    "Claude, 2 at work: 5 h 40% used",
  );
});

test("a reached limit says so with its reset; a window with no reading says so", () => {
  const observatory = townObservatoryFrom(runs("reached"), new Map(), NOW);
  if (observatory.status !== "ready") throw new Error("expected a reading");
  const claude = observatory.dials.find((dial) => dial.harness === "claude")!;
  expect(claude.cells.map(townObservatoryCellText)).toEqual([
    `limit · ${townResetTime(NOW + 40 * 60_000)}`,
    "no reading",
  ]);
  expect(townObservatorySpoken(observatory)).toContain(
    "5 h limit reached, resets",
  );
});

test("with nothing observed, an agent at work still shows its harness as unknown, never zero", () => {
  const working = townObservatoryWorking([
    { harness: "claude", semanticStatus: "working" },
    { harness: "codex", semanticStatus: "idle" },
    { semanticStatus: "working" },
  ]);
  expect([...working]).toEqual([["claude", 1]]);
  const observatory = townObservatoryFrom(runs("empty"), working, NOW);
  if (observatory.status !== "ready") throw new Error("expected a reading");
  expect(observatory.dials).toEqual([
    {
      harness: "claude",
      name: "Claude",
      cells: [
        { kind: "none", label: "5 h" },
        { kind: "none", label: "week" },
      ],
      stale: false,
      atWork: 1,
      note: null,
    },
  ]);
  expect(townObservatorySpoken(observatory)).not.toMatch(/\d%/);
  // Town's working agents count when they are more than the live runs.
  const more = townObservatoryFrom(runs("busy"), new Map([["claude", 5]]), NOW);
  if (more.status !== "ready") throw new Error("expected a reading");
  expect(more.atWork).toEqual([
    { harness: "claude", count: 5 },
    { harness: "codex", count: 1 },
    { harness: "cursor", count: 1 },
  ]);
});

test("loading and failed reads show no numbers; a failed read still lights who is at work", () => {
  const working = new Map([["codex", 2]]);
  expect(townObservatory({ status: "loading" }, working, NOW)).toEqual({
    status: "loading",
  });
  const failed = townObservatory({ status: "failed" }, working, NOW);
  expect(failed).toEqual({
    status: "failed",
    atWork: [{ harness: "codex", count: 2 }],
  });
  expect(townObservatorySpoken(failed)).toBe("usage unavailable");
});

test("more agents than windows light every window and count the rest", () => {
  const all = TOWN_OBSERVATORY_WINDOWS.length;
  expect(
    townObservatoryLit([
      { harness: "claude", count: all },
      { harness: "codex", count: 3 },
    ]),
  ).toEqual({ lit: Array(all).fill("claude"), more: 3 });
});

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
  ["empty", town({}), TOWN_SHAPES.wide],
  ["one building", town({ a: [1] }), TOWN_SHAPES.wide],
  ["one tall building", town({ a: [3, 3, 2, 2, 1, 1] }), TOWN_SHAPES.medium],
  ["two buildings", town({ a: [2], b: [1] }), TOWN_SHAPES.wide],
  [
    "two streets",
    town({ a: [2], b: [1], c: [1], d: [1], e: [1] }),
    TOWN_SHAPES.wide,
  ],
  // A phone and a portrait monitor stand it in the same civic row (#1351).
  ["phone, one building", town({ a: [1] }), TOWN_SHAPES.phone],
  [
    "phone, three buildings",
    town({ a: [2], b: [1], c: [4] }),
    TOWN_SHAPES.phone,
  ],
  ["portrait, two buildings", town({ a: [6], b: [1] }), TOWN_SHAPES.portrait],
];

test.each(towns)(
  "the observatory stands right of the library on the first street (%s), on clear land",
  (_, input, shape) => {
    const { layout } = layoutTown(input, shape);
    const lot = townObservatoryLot(layout);
    const area = townObservatoryReserve(lot);
    const { center } = layout;
    const firstStreet = Math.min(...layout.roads);
    // Right of the library's lot, a short lawn between, inside the town.
    const library = townLibraryReserve(townLibraryLot(layout));
    expect(area.x0).toBeGreaterThanOrEqual(library.x1);
    expect(lot.x).toBeGreaterThan(center.x + center.w);
    expect(lot.x - library.x1).toBeLessThanOrEqual(2);
    expect(area.x1).toBeLessThanOrEqual(layout.width);
    // Its door on the first street's pavement, above every building.
    expect(lot.y + lot.h).toBe(firstStreet);
    expect(layout.ground[firstStreet * layout.width + lot.x]).toBe(
      TownGround.walk,
    );
    for (const b of layout.buildings) expect(b.y).toBeGreaterThan(area.y1);
    // Clear of the post office on the center's other side.
    const post = townPostReserve(townPostLotBeside(layout.center));
    expect(post.x1).toBeLessThanOrEqual(area.x0);
    // No street lamp stands in front of it.
    for (const lamp of layout.lamps)
      if (lamp.y === firstStreet)
        expect(lamp.x < lot.x - 1 || lamp.x > lot.x + lot.w).toBe(true);
    // It stands on grass.
    for (let y = lot.y; y < lot.y + lot.h; y += 1)
      for (let x = lot.x; x < lot.x + lot.w; x += 1)
        expect(layout.ground[y * layout.width + x]).toBe(TownGround.grass);
    // Bus stops wait across the street from it.
    for (const stop of townBusRoute(layout).stops)
      expect(Math.floor(stop.wait.y / T)).toBeGreaterThan(firstStreet);
    // No tree, hedge or pond grows on its lot.
    const land = townLandscape(layout);
    for (let y = area.y0; y < area.y1; y += 1)
      for (let x = area.x0; x < area.x1; x += 1) {
        expect(land.reserved(x, y)).toBe(0);
        expect(land.objectAt(x, y)).toBeNull();
      }
  },
);

test("a narrow town stands the observatory as a building, clear of the harbour", () => {
  for (const input of [town({ a: [1] }), town({ a: [2], b: [1], c: [1] })]) {
    const { layout } = layoutTown(input, TOWN_SHAPES.phone);
    expect(layout.formFactor).toBe("narrow");
    const lot = townObservatoryLot(layout);
    const area = townObservatoryReserve(lot);
    // The harbour moves right with the wider town: its shore stays clear.
    const harbour = townHarbourReserve(townHarbourLot(layout));
    expect(area.x1 <= harbour.x0 || area.y1 <= harbour.y0).toBe(true);
    // Its dome is a target, as on a wide town (#1351).
    expect(townPlaceBoxes(layout).some(([key]) => key === "observatory")).toBe(
      true,
    );
  }
});

test("making room for the observatory moves nothing as the town grows", () => {
  const one = layoutTown(town({ a: [1] }), TOWN_SHAPES.wide).layout;
  const two = layoutTown(town({ a: [1], b: [1] }), TOWN_SHAPES.wide).layout;
  expect(two.buildings[0]!.x).toBe(one.buildings[0]!.x);
  expect(townObservatoryLot(two).x).toBeGreaterThanOrEqual(
    townObservatoryLot(one).x,
  );
});
