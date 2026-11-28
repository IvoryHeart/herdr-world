import { afterEach, expect, test } from "bun:test";
import {
  setTownArtDirection,
  TOWN_ART_DIRECTIONS,
  townArtDirection,
} from "./townArtDirection";
import { townArtLandmark } from "./townArtLandmarks";
import { TOWN_ART_STYLES } from "./townArtStyles";
import type { TownCanvas } from "./townSprites";

const page = globalThis as unknown as {
  location?: { href: string };
  history?: {
    state: unknown;
    replaceState: (s: unknown, t: string, u: URL) => void;
  };
};

/** A page at `href` whose replaceState rewrites its address. */
function openPage(href: string) {
  const replaced: string[] = [];
  page.location = { href };
  page.history = {
    state: null,
    replaceState: (_state, _title, url) => {
      replaced.push(String(url));
      page.location!.href = String(url);
    },
  };
  setTownArtDirection(undefined);
  return replaced;
}

afterEach(() => {
  delete page.location;
  delete page.history;
  setTownArtDirection(undefined);
});

test("reads the art direction once and drops the parameter", () => {
  const replaced = openPage(
    "https://world.example.test/town?townArt=harbour&x=1",
  );
  expect(townArtDirection()).toBe("harbour");
  expect(replaced).toEqual(["https://world.example.test/town?x=1"]);
  // Read once per page: later calls keep the choice without the parameter.
  expect(townArtDirection()).toBe("harbour");
  expect(replaced).toHaveLength(1);
});

test("an unknown value or no parameter keeps today's art", () => {
  const replaced = openPage("https://world.example.test/town?townArt=neon");
  expect(townArtDirection()).toBeNull();
  expect(replaced).toEqual(["https://world.example.test/town"]);
  const untouched = openPage("https://world.example.test/town");
  expect(townArtDirection()).toBeNull();
  expect(untouched).toEqual([]);
});

test("without a page there is no direction", () => {
  setTownArtDirection(undefined);
  expect(townArtDirection()).toBeNull();
});

test("today's art paints nothing in a direction", () => {
  setTownArtDirection(null);
  let calls = 0;
  const canvas = townArtLandmark("test-none", () => {
    calls += 1;
    return {} as TownCanvas;
  });
  expect(canvas).toBeNull();
  expect(calls).toBe(0);
});

test("each direction paints its landmark once, in its own style", () => {
  const styles: string[] = [];
  const draw = (
    style: (typeof TOWN_ART_STYLES)[keyof typeof TOWN_ART_STYLES],
  ) => {
    styles.push(style.name);
    return { style: style.name } as unknown as TownCanvas;
  };
  for (const direction of TOWN_ART_DIRECTIONS) {
    setTownArtDirection(direction);
    const first = townArtLandmark("test-house", draw);
    expect(townArtLandmark("test-house", draw)).toBe(first);
  }
  expect(styles).toEqual([...TOWN_ART_DIRECTIONS]);
});

test("every direction styles every landmark", () => {
  for (const direction of TOWN_ART_DIRECTIONS) {
    const style = TOWN_ART_STYLES[direction];
    expect(style.name).toBe(direction);
    for (const building of [
      style.post,
      style.library,
      style.warehouse,
      style.apartments,
      style.center,
      style.centerWing,
    ])
      for (const color of [
        building.wall,
        building.roof,
        building.trim,
        building.door,
      ])
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
  }
});
