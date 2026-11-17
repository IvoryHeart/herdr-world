import { expect, test } from "bun:test";
import {
  TOWN_BUBBLE_PATCH,
  townCalmBubbles,
  type TownBubbleCandidate,
} from "./townBubbleCalm";

const bubble = (
  key: string,
  kind: TownBubbleCandidate["kind"],
  x: number,
  y = 100,
  hostKey = "atlas",
): TownBubbleCandidate => ({ key, kind, hostKey, x, y });

test("a lobby crowd grumbles one at a time, and the turn passes round", () => {
  const crowd = ["c", "a", "b"].map((key, i) =>
    bubble(key, "curse", 100 + i * 200),
  );
  const speakers = [0, 1, 2, 3].map((turn) => [
    ...townCalmBubbles(crowd, true, turn),
  ]);
  expect(speakers).toEqual([["a"], ["b"], ["c"], ["a"]]);
});

test("each building's crowd has its own speaker, and other bubbles stay", () => {
  const shown = townCalmBubbles(
    [
      bubble("a1", "curse", 0, 0, "atlas"),
      bubble("a2", "curse", 300, 0, "atlas"),
      bubble("n1", "curse", 600, 0, "nova"),
      bubble("n2", "curse", 900, 0, "nova"),
      bubble("w", "blocked", 1200, 0, "nova"),
    ],
    true,
    1,
  );
  expect([...shown].sort()).toEqual(["a2", "n2", "w"]);
});

test("zoomed in, bubbles never thin by distance", () => {
  const close = [1, 2, 3].map((i) => bubble(`k${i}`, "blocked", 100 + i));
  expect(townCalmBubbles(close, true, 0).size).toBe(3);
});

test("zoomed out, a patch of screen holds one bubble, the most urgent", () => {
  const { w, h } = TOWN_BUBBLE_PATCH;
  const shown = townCalmBubbles(
    [
      bubble("finished", "done", 100, 100),
      bubble("asking", "ask", 104, 98),
      bubble("waiting", "blocked", 110, 104),
      // A patch clear of the kept bubble on either axis keeps its own.
      bubble("right", "done", 110 + w, 104),
      bubble("below", "done", 110, 104 + h),
    ],
    false,
    0,
  );
  expect([...shown].sort()).toEqual(["below", "right", "waiting"]);
});

test("hundreds of crowded far bubbles thin to what the screen can show", () => {
  const many: TownBubbleCandidate[] = [];
  for (let i = 0; i < 400; i++)
    many.push(bubble(`a${i}`, "blocked", (i % 40) * 6, Math.floor(i / 40) * 5));
  const shown = townCalmBubbles(many, false, 0);
  // 240 by 50 pixels of screen: 8 columns by 2 rows of patches at most.
  expect(shown.size).toBeLessThanOrEqual(9 * 3);
  expect(shown.size).toBeGreaterThan(0);
  const kept = many.filter((b) => shown.has(b.key));
  for (const a of kept)
    for (const b of kept)
      if (a !== b)
        expect(
          Math.abs(a.x - b.x) >= TOWN_BUBBLE_PATCH.w ||
            Math.abs(a.y - b.y) >= TOWN_BUBBLE_PATCH.h,
        ).toBe(true);
});
