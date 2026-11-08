import { expect, test } from "bun:test";
import { PULL_REQUEST_DETAIL_MAX_AGE_MS } from "../../../../shared/pullRequestFreshness";
import type {
  WorkItem,
  WorldSourcesSnapshot,
  WorldSourceStatus,
} from "../../../../shared/worldSources";
import { fixturePullRequest } from "../testing/pullRequestFixture";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { townBusRoute } from "./townBus";
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
  TOWN_POST_SLOTS,
  TOWN_POST_YARD_ROWS,
  townPostFoldAt,
  townPostLot,
  townPostOffice,
  townPostReserve,
  townPostSignText,
  townPostSlot,
  townPostState,
} from "./townPost";
import { MARGIN, ROAD_GAP } from "./townLots";
import { TOWN_POST_ROOM } from "./townPostLot";
import {
  townPostFixtureMerged,
  townPostFixtureSnapshot,
} from "./townPostFixture";

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
    townPostState(fixturePullRequest(1, fields), NOW);
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
  expect(townPostState(stale, NOW)).toEqual({
    state: "unknown",
    why: "details out of date",
  });
  // The same item turns unknown once its read expires.
  const fresh = fixturePullRequest(2);
  expect(townPostState(fresh, NOW).state).toBe("ready");
  expect(townPostState(fresh, fresh.prObservation!.expiresAt!).state).toBe(
    "unknown",
  );
  const open = fixturePullRequest(3);
  open.pr!.reviewers[0]!.outcome = "open";
  expect(townPostState(open, NOW)).toEqual({
    state: "waiting",
    why: "review findings open",
  });
});

test("the yard holds your open pull requests, ready first, and counts them", () => {
  const office = townPostOffice(
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
  expect(townPostSignText(office)).toBe(
    "2 ready · 1 failing · 1 waiting · 1 draft",
  );
  // No pull requests is GitHub's answer: real zeros.
  expect(townPostSignText(townPostOffice(snapshot([]), NOW))).toBe(
    "0 ready · 0 failing · 0 waiting",
  );
});

test("a source that is off, signed out or never answered shows no parcels or counts", () => {
  const items = [fixturePullRequest(1)];
  expect(townPostOffice({ ...snapshot(items), sources: [] }, NOW)).toEqual({
    status: "loading",
  });
  expect(
    townPostOffice(snapshot(items, { enabled: false, state: "disabled" }), NOW),
  ).toEqual({ status: "off" });
  const signedOut = townPostOffice(
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
  expect(townPostSignText(signedOut)).not.toMatch(/\d/);
  expect(
    townPostOffice(
      snapshot(items, { state: "error", lastSuccessAt: null }),
      NOW,
    ).status,
  ).toBe("closed");
  // A failed refresh keeps the last list, and none of it is current.
  const stale = townPostOffice(
    snapshot(items, { state: "error", detail: "Rate limited" }),
    NOW,
  );
  if (stale.status !== "open") throw new Error("expected the last list");
  expect(stale.stale).toBe(true);
  expect(stale.parcels.map((parcel) => parcel.state)).toEqual(["unknown"]);
  expect(stale.counts.ready).toBe(0);
  expect(townPostSignText(stale)).toBe("GitHub out of date · 1 unknown");
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
  "the post office stands left of the town center on the first street (%s), on clear land",
  (_, input, shape) => {
    const { layout } = layoutTown(input, shape);
    const lot = townPostLot(layout)!;
    expect(lot).not.toBeNull();
    const area = townPostReserve(lot);
    const { center } = layout;
    const firstStreet = Math.min(...layout.roads);
    // Left of the center's west wing, a short lawn between, inside the town.
    expect(area.x1).toBeLessThan(center.x);
    expect(center.x - (lot.x + lot.w)).toBeLessThanOrEqual(3);
    expect(area.x0).toBeGreaterThanOrEqual(0);
    expect(lot.x).toBeGreaterThanOrEqual(3);
    // Its yard's front edge on the first street's pavement, as the center's
    // steps are, so it fronts the road; above every building.
    expect(lot.y).toBeGreaterThanOrEqual(center.y);
    expect(lot.yardY + TOWN_POST_YARD_ROWS).toBe(firstStreet);
    expect(layout.ground[firstStreet * layout.width + lot.x]).toBe(
      TownGround.walk,
    );
    for (const b of layout.buildings) expect(b.y).toBeGreaterThan(area.y1);
    // No street lamp stands in front of the yard.
    for (const lamp of layout.lamps)
      if (lamp.y === firstStreet)
        expect(lamp.x < area.x0 || lamp.x >= area.x1).toBe(true);
    // The house and the yard stand on grass.
    for (let y = lot.y; y < lot.yardY + TOWN_POST_YARD_ROWS; y += 1)
      for (let x = lot.x; x < lot.x + lot.w; x += 1)
        expect(layout.ground[y * layout.width + x]).toBe(TownGround.grass);
    // Every bus stop waits on a street's pavement across the road from it.
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

test("making room for the post office moves nothing as the town grows", () => {
  // Every wide town stands the lot's columns further right, its side roads
  // and plaza with it, so even a one-building town has lawn for the lot.
  const { layout } = layoutTown(town({ a: [1] }), TOWN_SHAPES.wide);
  const shift = TOWN_POST_ROOM;
  expect(townPostLot(layout)!.x).toBe(layout.center.x - shift);
  expect(townPostLot(layout)!.x).toBeGreaterThanOrEqual(3);
  const b = layout.buildings[0]!;
  // The road down the town's left side stands left of the building, the
  // lot's columns left of that road.
  expect(b.x).toBe(MARGIN + ROAD_GAP + shift);
  const [edge, side] = layout.verticalRoads;
  expect(edge).toMatchObject({ x: b.x - ROAD_GAP, edge: true });
  expect(side!.x).toBe(b.x + b.w);
  expect(layout.plaza.x).toBe(shift + Math.floor((layout.width - shift) / 2));
  // A town that grows a building keeps its first one where it stood; its
  // center, centred over the wider row, takes the post office with it.
  const grown = layoutTown(town({ a: [1], b: [1] }), TOWN_SHAPES.wide).layout;
  expect(grown.buildings[0]!.x).toBe(b.x);
  expect(townPostLot(grown)!.x).toBe(grown.center.x - shift);
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
  "the post office is in a laptop's home view (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.wide);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townPostLot(layout)!;
    const topLeft = camera.toScreen(lot.x * T, lot.y * T);
    const bottomRight = camera.toScreen(
      (lot.x + lot.w) * T,
      (lot.yardY + TOWN_POST_YARD_ROWS) * T,
    );
    expect(topLeft.x).toBeGreaterThanOrEqual(viewport.inset.left);
    expect(topLeft.y).toBeGreaterThanOrEqual(viewport.inset.top);
    expect(bottomRight.x).toBeLessThanOrEqual(width - viewport.inset.right);
    expect(bottomRight.y).toBeLessThanOrEqual(height - viewport.inset.bottom);
  },
);

test("a narrow town folds the post office to a sign: no lot", () => {
  const { layout } = layoutTown(town({ a: [2] }), TOWN_SHAPES.phone);
  expect(townPostLot(layout)).toBeNull();
});

test.each([
  ["one single-desk room", town({ a: [1] }), 390, 844],
  ["three single-desk rooms", town({ a: [1, 1, 1] }), 390, 844],
  ["three single-desk rooms, small phone", town({ a: [1, 1, 1] }), 360, 640],
  ["a tall building", town({ a: [6, 4, 3, 2] }), 390, 844],
] as const)(
  "the folded sign stands inside a phone's home view (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const at = townPostFoldAt(layout.center);
    const sign = camera.toScreen(at.x, at.y);
    // The sign keeps its screen size near home zoom (--iz): about 100 by
    // 30 pixels around its point, all of it inside the chrome's insets.
    const { inset } = viewport;
    expect(sign.x - 50).toBeGreaterThanOrEqual(inset.left);
    expect(sign.x + 50).toBeLessThanOrEqual(width - inset.right);
    expect(sign.y - 15).toBeGreaterThanOrEqual(inset.top);
    expect(sign.y + 15).toBeLessThanOrEqual(height - inset.bottom);
    // On the center's front, clear of its plaque and doors in the middle.
    const center = layout.center;
    expect(at.x).toBeLessThan((center.x + center.w) * T);
    expect(at.x - 50).toBeGreaterThan((center.x + center.w / 2) * T + 24);
    expect(at.y).toBeLessThan((center.y + center.h) * T);
  },
);

test("the yard's slots fit its planks, the trolley's end kept clear", () => {
  const last = townPostSlot(TOWN_POST_SLOTS - 1);
  // The trolley's handle starts 36 pixels from the yard's right end; a
  // parcel's tag reaches 3 pixels past its box.
  expect(last.x + 16 + 3).toBeLessThanOrEqual(12 * T - 36);
  expect(last.y + 13).toBeLessThanOrEqual(TOWN_POST_YARD_ROWS * T - 6);
});

test("the testing fixture covers every state and merges a ready parcel", () => {
  const fixture = townPostFixtureSnapshot("pile", NOW);
  const office = townPostOffice(fixture, NOW);
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
  const merged = townPostOffice(townPostFixtureMerged(fixture), NOW);
  if (merged.status !== "open") throw new Error("expected an open office");
  expect(merged.counts.ready).toBe(1);
  expect(
    townPostOffice(townPostFixtureSnapshot("many", NOW), NOW),
  ).toMatchObject({
    status: "open",
  });
  expect(townPostOffice(townPostFixtureSnapshot("off", NOW), NOW).status).toBe(
    "closed",
  );
});
