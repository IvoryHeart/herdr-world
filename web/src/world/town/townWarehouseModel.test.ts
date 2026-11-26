import { expect, test } from "bun:test";
import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../../shared/pullRequestFreshness";
import type {
  WorkItem,
  WorldSourcesSnapshot,
  WorldSourceStatus,
} from "../../../../shared/worldSources";
import { fixturePullRequest } from "../testing/pullRequestFixture";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownCamera } from "./townCamera";
import { townLandscape } from "./townLandscape";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  TownGround,
  type TownInput,
  type TownShape,
} from "./townLayout";
import {
  TOWN_WAREHOUSE_SLOTS,
  TOWN_WAREHOUSE_YARD_ROWS,
  townWarehouseLot,
  townWarehouse,
  townWarehouseSignText,
  townWarehouseSlot,
  townWarehouseState,
} from "./townWarehouseModel";
import { townHarbourLot } from "./townHarbour";
import { TOWN_HARBOUR_ROOM, townWarehouseReserve } from "./townHarbourLot";
import { townPostLotBeside, townPostReserve } from "./townPostLot";
import {
  townWarehouseFixtureMerged,
  townWarehouseFixtureSnapshot,
} from "./townWarehouseFixture";

// A minute ahead: after every fixture read below, well inside its freshness.
const NOW = Date.now() + 60_000;

function github(fields: Partial<WorldSourceStatus> = {}): WorldSourceStatus {
  return {
    id: "github",
    label: "GitHub",
    enabled: true,
    state: "connected",
    detail: "Up to date",
    checkedAt: NOW,
    lastSuccessAt: NOW,
    itemCount: 0,
    config: { kind: "github", mergedDays: 7 },
    ...fields,
  };
}

function snapshot(
  items: WorkItem[],
  source: Partial<WorldSourceStatus> = {},
): WorldSourcesSnapshot {
  return {
    observedAt: NOW,
    refreshing: false,
    sources: [github(source)],
    items,
    links: [],
    actions: [],
  };
}

test("a pull request's parcel says where it stands, never ready on stale detail", () => {
  const state = (fields: Partial<WorkItem>) =>
    townWarehouseState(fixturePullRequest(1, fields), NOW);
  expect(state({})).toEqual({ state: "ready", why: "ready to merge" });
  expect(state({ checks: "fail", lane: "fixing" }).state).toBe("failing");
  expect(state({ draft: true }).state).toBe("draft");
  expect(state({ checks: "pending" })).toEqual({
    state: "waiting",
    why: "waiting for CI",
  });
  expect(state({ roles: ["reviewer"] })).toEqual({
    state: "waiting",
    why: "your review requested",
  });
  expect(state({ mergeable: "conflicting" }).why).toBe(
    "conflicts with its base",
  );
  // Every rule passes, but the detail is older than its freshness window.
  const old = NOW - 2 * PULL_REQUEST_DETAIL_MAX_AGE_MS;
  const stale = fixturePullRequest(1);
  stale.prObservation = {
    ...stale.prObservation!,
    readAt: old,
    expiresAt: old + PULL_REQUEST_DETAIL_MAX_AGE_MS,
  };
  expect(townWarehouseState(stale, NOW)).toEqual({
    state: "unknown",
    why: "details out of date",
  });
  // The same item turns unknown once its read expires.
  const fresh = fixturePullRequest(2);
  expect(townWarehouseState(fresh, NOW).state).toBe("ready");
  expect(townWarehouseState(fresh, fresh.prObservation!.expiresAt!).state).toBe(
    "unknown",
  );
  const open = fixturePullRequest(3);
  open.pr!.reviewers[0]!.outcome = "open";
  expect(townWarehouseState(open, NOW)).toEqual({
    state: "waiting",
    why: "review findings open",
  });
});

test("the yard holds your open pull requests, ready first, and counts them", () => {
  const office = townWarehouse(
    snapshot([
      fixturePullRequest(1, { checks: "pending", updatedAt: 5 }),
      fixturePullRequest(2, { updatedAt: 1 }),
      fixturePullRequest(3, { lane: "merged" }),
      fixturePullRequest(4, { checks: "fail", updatedAt: 3 }),
      fixturePullRequest(5, { draft: true, updatedAt: 9 }),
      fixturePullRequest(6, { roles: ["watcher"] }),
      fixturePullRequest(7, { updatedAt: 2 }),
      { ...fixturePullRequest(8), kind: "issue" },
    ]),
    NOW,
  );
  if (office.status !== "open") throw new Error("expected an open office");
  expect(office.parcels.map((parcel) => parcel.number)).toEqual([
    7, 2, 4, 1, 5,
  ]);
  expect(office.counts).toEqual({
    ready: 2,
    failing: 1,
    waiting: 1,
    unknown: 0,
    draft: 1,
  });
  expect(townWarehouseSignText(office)).toBe(
    "2 ready · 1 failing · 1 waiting · 1 draft",
  );
  // No pull requests is GitHub's answer: real zeros.
  expect(townWarehouseSignText(townWarehouse(snapshot([]), NOW))).toBe(
    "0 ready · 0 failing · 0 waiting",
  );
});

test("a source that is off, signed out or never answered shows no parcels or counts", () => {
  const items = [fixturePullRequest(1)];
  expect(townWarehouse({ ...snapshot(items), sources: [] }, NOW)).toEqual({
    status: "loading",
  });
  expect(
    townWarehouse(snapshot(items, { enabled: false, state: "disabled" }), NOW),
  ).toEqual({ status: "off" });
  const signedOut = townWarehouse(
    snapshot([], {
      state: "not_connected",
      detail: "Sign in with gh auth login.",
      lastSuccessAt: null,
    }),
    NOW,
  );
  expect(signedOut).toEqual({
    status: "closed",
    detail: "Sign in with gh auth login.",
  });
  expect(townWarehouseSignText(signedOut)).not.toMatch(/\d/);
  expect(
    townWarehouse(snapshot(items, { state: "error", lastSuccessAt: null }), NOW)
      .status,
  ).toBe("closed");
  // A failed refresh keeps the last list, and none of it is current.
  const stale = townWarehouse(
    snapshot(items, { state: "error", detail: "Rate limited" }),
    NOW,
  );
  if (stale.status !== "open") throw new Error("expected the last list");
  expect(stale.stale).toBe(true);
  expect(stale.parcels.map((parcel) => parcel.state)).toEqual(["unknown"]);
  expect(stale.counts.ready).toBe(0);
  expect(townWarehouseSignText(stale)).toBe("GitHub out of date · 1 unknown");
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
];

test.each(towns)(
  "the warehouse stands on the shore at the first street's end (%s), on clear land",
  (_, input, shape) => {
    const { layout } = layoutTown(input, shape);
    const lot = townWarehouseLot(layout)!;
    expect(lot).not.toBeNull();
    const harbour = townHarbourLot(layout)!;
    const area = townWarehouseReserve(lot);
    const { center } = layout;
    const firstStreet = Math.min(...layout.roads);
    // On the shore: right of every building and the center, the promenade
    // and the sea beyond it.
    expect(lot.x).toBe(harbour.x);
    expect(lot.x + lot.w).toBeLessThanOrEqual(harbour.streetEnd);
    expect(lot.x).toBeGreaterThanOrEqual(center.x + center.w);
    for (const b of layout.buildings)
      expect(lot.x).toBeGreaterThanOrEqual(b.x + b.w);
    expect(area.x1).toBeLessThanOrEqual(harbour.coast);
    // Clear of the post office beside the center.
    const post = townPostReserve(townPostLotBeside(center));
    expect(post.x1 <= area.x0 || area.x1 <= post.x0).toBe(true);
    // Its yard's front edge on the first street's pavement, as the center's
    // steps are, so it fronts the road.
    expect(lot.y).toBeGreaterThanOrEqual(0);
    expect(lot.yardY + TOWN_WAREHOUSE_YARD_ROWS).toBe(firstStreet);
    expect(layout.ground[firstStreet * layout.width + lot.x]).toBe(
      TownGround.walk,
    );
    // No street lamp stands in front of the yard.
    for (const lamp of layout.lamps)
      if (lamp.y === firstStreet)
        expect(lamp.x < area.x0 || lamp.x >= area.x1).toBe(true);
    // The house and the yard stand on grass.
    for (let y = lot.y; y < lot.yardY + TOWN_WAREHOUSE_YARD_ROWS; y += 1)
      for (let x = lot.x; x < lot.x + lot.w; x += 1)
        expect(layout.ground[y * layout.width + x]).toBe(TownGround.grass);
    // No tree, hedge or pond grows on its lot.
    const land = townLandscape(layout);
    for (let y = Math.max(0, area.y0); y < area.y1; y += 1)
      for (let x = area.x0; x < area.x1; x += 1) {
        expect(land.reserved(x, y)).toBe(0);
        expect(land.objectAt(x, y)).toBeNull();
      }
  },
);

test("making room for the harbour moves nothing as the town grows", () => {
  // Every wide town adds the harbour's columns at its right edge, so the
  // buildings stand where they would without it.
  const { layout } = layoutTown(town({ a: [1] }), TOWN_SHAPES.wide);
  const harbour = townHarbourLot(layout)!;
  expect(harbour.right).toBe(layout.width);
  expect(layout.width - harbour.x).toBe(TOWN_HARBOUR_ROOM);
  const b = layout.buildings[0]!;
  const grown = layoutTown(town({ a: [1], b: [1] }), TOWN_SHAPES.wide).layout;
  expect(grown.buildings[0]!.x).toBe(b.x);
  expect(grown.width - townHarbourLot(grown)!.x).toBe(TOWN_HARBOUR_ROOM);
});

test.each([
  ["laptop, one building", town({ a: [1] }), 1440, 900],
  ["small laptop, two buildings", town({ a: [2], b: [1] }), 1280, 720],
  [
    "laptop, two streets",
    town({ a: [2], b: [1], c: [1], d: [1], e: [1] }),
    1440,
    900,
  ],
] as const)(
  "the warehouse is in a laptop's home view (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.wide);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townWarehouseLot(layout)!;
    const topLeft = camera.toScreen(lot.x * T, lot.y * T);
    const bottomRight = camera.toScreen(
      (lot.x + lot.w) * T,
      (lot.yardY + TOWN_WAREHOUSE_YARD_ROWS) * T,
    );
    expect(topLeft.x).toBeGreaterThanOrEqual(viewport.inset.left);
    expect(topLeft.y).toBeGreaterThanOrEqual(viewport.inset.top);
    expect(bottomRight.x).toBeLessThanOrEqual(width - viewport.inset.right);
    expect(bottomRight.y).toBeLessThanOrEqual(height - viewport.inset.bottom);
  },
);

test("a narrow town keeps the warehouse on its shore, right of the buildings", () => {
  const { layout } = layoutTown(town({ a: [2] }), TOWN_SHAPES.phone);
  const lot = townWarehouseLot(layout);
  const first = layout.buildings[0]!;
  expect(lot.x).toBeGreaterThan(first.x + first.w);
  expect(lot.yardY + TOWN_WAREHOUSE_YARD_ROWS).toBe(layout.center.street);
});

test.each([
  ["one single-desk room", town({ a: [1] }), 390, 844],
  ["three single-desk rooms", town({ a: [1, 1, 1] }), 390, 844],
  ["three single-desk rooms, small phone", town({ a: [1, 1, 1] }), 360, 640],
  ["a tall building", town({ a: [6, 4, 3, 2] }), 390, 844],
] as const)(
  "a phone reaches the whole warehouse by panning at home zoom, tappable (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const home = camera.z;
    // The building on its shore, not a sign on the town center (#1351).
    const lot = townWarehouseLot(layout);
    const bottom = (lot.yardY + TOWN_WAREHOUSE_YARD_ROWS) * T;
    camera.jumpTo((lot.x + lot.w / 2) * T, (lot.y * T + bottom) / 2, home);
    const topLeft = camera.toScreen(lot.x * T, lot.y * T);
    const bottomRight = camera.toScreen((lot.x + lot.w) * T, bottom);
    const { inset } = viewport;
    expect(topLeft.x).toBeGreaterThanOrEqual(inset.left);
    expect(topLeft.y).toBeGreaterThanOrEqual(inset.top);
    expect(bottomRight.x).toBeLessThanOrEqual(width - inset.right);
    expect(bottomRight.y).toBeLessThanOrEqual(height - inset.bottom);
    expect(bottomRight.x - topLeft.x).toBeGreaterThanOrEqual(44);
    expect(bottomRight.y - topLeft.y).toBeGreaterThanOrEqual(44);
  },
);

test("the yard's slots fit its planks, the trolley's end kept clear", () => {
  const last = townWarehouseSlot(TOWN_WAREHOUSE_SLOTS - 1);
  // The trolley's handle starts 36 pixels from the yard's right end; a
  // parcel's tag reaches 3 pixels past its box.
  expect(last.x + 16 + 3).toBeLessThanOrEqual(12 * T - 36);
  expect(last.y + 13).toBeLessThanOrEqual(TOWN_WAREHOUSE_YARD_ROWS * T - 6);
});

test("the testing fixture covers every state and merges a ready parcel", () => {
  const fixture = townWarehouseFixtureSnapshot("pile", NOW);
  const office = townWarehouse(fixture, NOW);
  if (office.status !== "open") throw new Error("expected an open office");
  expect(office.counts).toEqual({
    ready: 2,
    failing: 1,
    waiting: 3,
    unknown: 1,
    draft: 1,
  });
  expect(
    fixture.items.every((item) => item.url.startsWith("https://example.com/")),
  ).toBe(true);
  const merged = townWarehouse(townWarehouseFixtureMerged(fixture), NOW);
  if (merged.status !== "open") throw new Error("expected an open office");
  expect(merged.counts.ready).toBe(1);
  expect(
    townWarehouse(townWarehouseFixtureSnapshot("many", NOW), NOW),
  ).toMatchObject({
    status: "open",
  });
  expect(
    townWarehouse(townWarehouseFixtureSnapshot("off", NOW), NOW).status,
  ).toBe("closed");
});
