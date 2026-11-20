import { afterEach, expect, test } from "bun:test";
import type { WorldAsk } from "../worldAsks";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownCamera } from "./townCamera";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  type TownInput,
} from "./townLayout";
import {
  TOWN_POST_WIDTH,
  TOWN_POST_YARD_ROWS,
  townPostLotBeside,
} from "./townPostLot";
import {
  TOWN_LETTER_SIZE,
  TOWN_POST_SLOTS,
  TOWN_POST_TROLLEY,
  townLetterAge,
  townLetterLabel,
  townPostCountParts,
  townPostOffice,
  townPostSignAt,
  townPostSignText,
  townPostSlot,
  townPostSpoken,
  townPostYardCount,
} from "./townPostModel";
import {
  resetTownPostFixture,
  townPostFixture,
  townPostFixtureMode,
} from "./townPostFixture";

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
});

test("the sign counts letters in and answers out, or says there is no mail", () => {
  expect(townPostSignText(townPostOffice([], none))).toBe("No mail");
  expect(townPostSpoken(townPostOffice([], none))).toBe("no mail");
  expect(townPostSignText(townPostOffice([ask("a", 1)], none))).toBe(
    "1 letter",
  );
  const full = townPostOffice([ask("a", 1), ask("b", 2)], {
    waiting: 1,
    checks: 2,
  });
  expect(townPostSignText(full)).toBe("2 letters · 1 to send · 2 to check");
  expect(townPostCountParts(full).map((part) => part.kind)).toEqual([
    "letters",
    "waiting",
    "checks",
  ]);
  expect(townPostSpoken(full)).toBe(
    "2 questions for you, 1 answer to send, 2 answers to check",
  );
  // Answers out alone still make mail.
  expect(townPostSignText(townPostOffice([], { waiting: 0, checks: 1 }))).toBe(
    "1 to check",
  );
});

test("the yard's letters fit its planks, the trolley's end kept clear", () => {
  const yardW = TOWN_POST_WIDTH * T;
  const last = townPostSlot(TOWN_POST_SLOTS - 1);
  // The trolley's handle starts six pixels left of its bed.
  expect(last.x + TOWN_LETTER_SIZE.w).toBeLessThan(
    yardW - TOWN_POST_TROLLEY.fromRight - 6,
  );
  expect(last.y + TOWN_LETTER_SIZE.h).toBeLessThanOrEqual(
    TOWN_POST_YARD_ROWS * T,
  );
  expect(townPostYardCount(3)).toBe(3);
  expect(townPostYardCount(TOWN_POST_SLOTS)).toBe(TOWN_POST_SLOTS);
  // One more than the yard holds: the last slot becomes the bundle.
  expect(townPostYardCount(TOWN_POST_SLOTS + 1)).toBe(TOWN_POST_SLOTS - 1);
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

test.each([
  ["one single-desk room", town({ a: [1] }), 390, 844],
  ["three single-desk rooms", town({ a: [1, 1, 1] }), 390, 844],
  ["three single-desk rooms, small phone", town({ a: [1, 1, 1] }), 360, 640],
  ["a tall building", town({ a: [6, 4, 3, 2] }), 390, 844],
] as const)(
  "a phone's home view shows the post office's sign and yard (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townPostLotBeside(layout.center);
    const at = townPostSignAt(lot, true);
    const sign = camera.toScreen(at.x, at.y);
    // Near home zoom the narrow plate keeps its screen size (--iz): 104
    // pixels wide with its border and at most 60 tall with three counts,
    // growing up and right of its point.
    const { inset } = viewport;
    expect(sign.x).toBeGreaterThanOrEqual(inset.left);
    expect(sign.x + 104).toBeLessThanOrEqual(width - inset.right);
    expect(sign.y - 60).toBeGreaterThanOrEqual(inset.top);
    // Its zoom keeps the plate at screen size, not shrunk with the town.
    expect(1 / camera.z).toBeLessThanOrEqual(2.4);
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
  expect(
    townPostSignText(
      townPostOffice([], townPostFixture("empty", now).outgoing),
    ),
  ).toBe("No mail");
});
