import { afterEach, expect, test } from "bun:test";
import { needsYouCount, type NeedsYouItem } from "../needsYou";
import type { WorldAsk } from "../worldAsks";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownCamera } from "./townCamera";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import {
  TOWN_LETTER_SIZE,
  TOWN_POST_EMPTY,
  TOWN_POST_SLOTS,
  TOWN_POST_TROLLEY,
  townLetterAge,
  townLetterLabel,
  townPostCounts,
  townPostOffice,
  townPostParts,
  townPostSignAt,
  townPostSlot,
  townPostSpoken,
  townPostWaiting,
  townPostYardCount,
} from "./townPostModel";
import {
  TOWN_POST_WIDTH,
  TOWN_POST_YARD_ROWS,
  townPostLotBeside,
} from "./townPostLot";
import {
  resetTownPostFixture,
  townPostFixture,
  townPostFixtureMode,
} from "./townPostFixture";

const items = (
  ...kinds: NeedsYouItem["kind"][]
): Pick<NeedsYouItem, "kind">[] => kinds.map((kind) => ({ kind }));

test("it counts Needs you's items by kind, and the Outbox's checks", () => {
  const listed = items("asks", "asks", "needs", "done", "done", "done");
  const counts = townPostCounts(listed, 1);
  expect(counts).toEqual({ asks: 2, needs: 1, done: 3, outbox: 1 });
  // Waiting is what the top bar's counter counts: asks and blocked agents.
  expect(townPostWaiting(counts)).toBe(needsYouCount(listed as NeedsYouItem[]));
});

test("its sign reads at a glance: urgent first, empty kinds left out", () => {
  const parts = townPostParts({ asks: 2, needs: 1, done: 0, outbox: 1 });
  expect(parts.map((part) => [part.mark, part.text])).toEqual([
    ["asks", "2 questions"],
    ["needs", "1 blocked"],
    [null, "1 to check"],
  ]);
  expect(townPostSpoken({ asks: 1, needs: 2, done: 1, outbox: 2 })).toBe(
    "1 question for you, 2 agents blocked, 1 finished to review, 2 answers to check",
  );
  expect(townPostParts(TOWN_POST_EMPTY)).toEqual([]);
  expect(townPostSpoken(TOWN_POST_EMPTY)).toBe("nothing for you");
});

const town = (rooms: number[]) => ({
  hosts: [{ key: "a", displayOrder: 0 }],
  rooms: rooms.map((desks, order) => ({
    key: `a/${order}`,
    hostKey: "a",
    order,
    deskKeys: Array.from({ length: desks }, (_, desk) => `a/${order}/${desk}`),
  })),
});

test("a wide town's sign stands on the post office's roof, not on the town center", () => {
  const { layout } = layoutTown(town([2, 1]), TOWN_SHAPES.wide);
  const lot = townPostLotBeside(layout.center);
  const at = townPostSignAt(lot);
  // Anchored at its bottom-right, the sign grows up and left over the lot.
  expect(at.x).toBeGreaterThan(lot.x * T);
  expect(at.x).toBeLessThanOrEqual((lot.x + lot.w) * T);
  expect(at.x).toBeLessThan(layout.center.x * T);
  expect(at.y).toBeLessThan(lot.yardY * T);
});

test.each([
  ["one single-desk room", [1], 390, 844],
  ["three single-desk rooms", [1, 1, 1], 390, 844],
  ["three single-desk rooms, small phone", [1, 1, 1], 360, 640],
  ["a tall building", [6, 4, 3, 2], 390, 844],
] as const)(
  "a narrow town stands the full sign on its roof, in a phone's home view (%s)",
  (_, rooms, width, height) => {
    const { layout } = layoutTown(town([...rooms]), TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townPostLotBeside(layout.center);
    const at = townPostSignAt(lot, layout.formFactor);
    // The wide sign, not a folded one (#1351), centred on the ridge and
    // growing straight up with its counts stacked. It keeps its screen size
    // near home zoom (--iz): at most about 104 by 68 pixels with all four
    // counts, so it stays on screen and about its house's width.
    const z = camera.z;
    const scale = z * Math.min(2.4, Math.max(0.5, 1 / z));
    const sign = camera.toScreen(at.x, at.y);
    const { inset } = viewport;
    expect(sign.x - 52 * scale).toBeGreaterThanOrEqual(inset.left);
    expect(sign.y - 68 * scale).toBeGreaterThanOrEqual(inset.top);
    expect(sign.x + 52 * scale).toBeLessThanOrEqual(width - inset.right);
    // Clear of the town center across the lawn.
    expect(camera.toScreen(layout.center.x * T, 0).x).toBeGreaterThan(
      sign.x + 52 * scale,
    );
    expect(at.x).toBe((lot.x + lot.w / 2) * T);
    expect(at.y).toBeLessThan(lot.yardY * T);
  },
);

const ask = (
  id: string,
  at: number,
  fields: Partial<WorldAsk["actor"]> = {},
): WorldAsk => ({
  id,
  at,
  actor: {
    label: `agent-${id}`,
    verified: true,
    name: `agent-${id}`,
    ...fields,
  },
  question: `Question ${id}?`,
  options: ["Yes", "No"],
  owner_only: false,
});

const none = { waiting: 0, checks: 0 };

test("letters are the open questions, oldest first, unverified callers marked", () => {
  const office = townPostOffice(
    [
      ask("b", 2_000),
      ask("a", 1_000, { verified: false, name: undefined, pane_id: "p-7" }),
    ],
    none,
  );
  expect(office.letters.map((letter) => letter.id)).toEqual(["a", "b"]);
  expect(townLetterLabel(office.letters[0]!)).toBe(
    "Letter from p-7 (unverified): Question a?",
  );
  expect(townLetterLabel(office.letters[1]!)).toBe(
    "Letter from agent-b: Question b?",
  );
  // Answers out never go negative.
  expect(townPostOffice([], { waiting: -1, checks: 2 }).outgoing).toEqual({
    waiting: 0,
    checks: 2,
  });
});

test("the yard's letters fit its cobbles, the trolley's end kept clear", () => {
  const yardW = TOWN_POST_WIDTH * T;
  const last = townPostSlot(TOWN_POST_SLOTS - 1);
  // The trolley's handle starts seven pixels left of its bed.
  expect(last.x + TOWN_LETTER_SIZE.w).toBeLessThan(
    yardW - TOWN_POST_TROLLEY.fromRight - 7,
  );
  expect(last.y + TOWN_LETTER_SIZE.h).toBeLessThanOrEqual(
    TOWN_POST_YARD_ROWS * T,
  );
  expect(townPostYardCount(3)).toBe(3);
  expect(townPostYardCount(TOWN_POST_SLOTS)).toBe(TOWN_POST_SLOTS);
  // One more than the yard holds: the last slot becomes the bundle.
  expect(townPostYardCount(TOWN_POST_SLOTS + 1)).toBe(TOWN_POST_SLOTS - 1);
});

test.each([
  ["one single-desk room", [1], 390, 844],
  ["three single-desk rooms", [1, 1, 1], 390, 844],
  ["three single-desk rooms, small phone", [1, 1, 1], 360, 640],
  ["a tall building", [6, 4, 3, 2], 390, 844],
] as const)(
  "a phone's home view shows the post office's yard (%s)",
  (_, rooms, width, height) => {
    const { layout } = layoutTown(town([...rooms]), TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townPostLotBeside(layout.center);
    const { inset } = viewport;
    const yard = camera.toScreen(
      lot.x * T,
      (lot.yardY + TOWN_POST_YARD_ROWS) * T,
    );
    expect(yard.x).toBeGreaterThanOrEqual(inset.left);
    expect(yard.y).toBeLessThanOrEqual(height - inset.bottom);
  },
);

test("a letter's age reads in minutes, hours or days", () => {
  const now = 10 * 86_400_000;
  expect(townLetterAge(now - 10_000, now)).toBe("just now");
  expect(townLetterAge(now - 12 * 60_000, now)).toBe("12 min ago");
  expect(townLetterAge(now - 3 * 3_600_000, now)).toBe("3 h ago");
  expect(townLetterAge(now - 3 * 86_400_000, now)).toBe("3 days ago");
});

afterEach(() => resetTownPostFixture());

test("the fixture switch is read once and leaves the address", () => {
  const original = globalThis.location;
  const history = globalThis.history;
  let replaced = "";
  Object.defineProperty(globalThis, "location", {
    value: { href: "http://world.example/?townPostFixture=many&view=town" },
    configurable: true,
  });
  Object.defineProperty(globalThis, "history", {
    value: {
      state: null,
      replaceState: (_: unknown, __: string, url: URL) => {
        replaced = String(url);
      },
    },
    configurable: true,
  });
  try {
    expect(townPostFixtureMode()).toBe("many");
    expect(replaced).toBe("http://world.example/?view=town");
  } finally {
    Object.defineProperty(globalThis, "location", {
      value: original,
      configurable: true,
    });
    Object.defineProperty(globalThis, "history", {
      value: history,
      configurable: true,
    });
  }
  const now = Date.now();
  const letters = townPostOffice(
    townPostFixture("letters", now).asks,
    townPostFixture("letters", now).outgoing,
  );
  expect(letters.letters.length).toBe(4);
  expect(letters.letters.some((letter) => !letter.verified)).toBe(true);
  expect(townPostFixture("many", now).asks.length).toBeGreaterThan(
    TOWN_POST_SLOTS,
  );
  const empty = townPostOffice([], townPostFixture("empty", now).outgoing);
  expect(empty.letters).toEqual([]);
  expect(empty.outgoing).toEqual(none);
});
