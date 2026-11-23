import { expect, test } from "bun:test";
import { Crown, UserPlus } from "lucide-react";
import type { TownCenterAction } from "./TownCenterMenu";
import {
  TOWN_CENTER_BUILDINGS,
  townCenterBuildings,
  withBuildingsAction,
} from "./townCenterBuildings";
import { TownPlaces, type TownPlaceKey } from "./townPlaces";

const first: TownCenterAction[] = [
  { id: "launch", label: "New agent", icon: UserPlus, run: () => undefined },
  { id: "master", label: "Town master", icon: Crown, run: () => undefined },
  { id: "room", label: "New room", icon: Crown, run: () => undefined },
];

function town(keys: readonly TownPlaceKey[]) {
  const opened: TownPlaceKey[] = [];
  const places = new TownPlaces();
  for (const key of keys) places.register(key, () => opened.push(key));
  return { places, opened };
}

test("Buildings follows the Town master and opens a second ring instead of running", () => {
  const { places } = town(["library", "post"]);
  const actions = withBuildingsAction(first, places);
  expect(actions.map((action) => action.id)).toEqual([
    "launch",
    "master",
    "buildings",
    "room",
  ]);
  const buildings = actions[2]!;
  expect(buildings.label).toBe("Buildings");
  expect(buildings.count).toBeUndefined();
  expect(buildings.detail).toBeUndefined();
  expect(buildings.ring?.().map((action) => action.id)).toEqual([
    "library",
    "post",
  ]);
});

test("the second ring lists every place with a building, each opening it as its building does", () => {
  const all = TOWN_CENTER_BUILDINGS.map(({ key }) => key);
  // Every place townPlaces.ts gives a building.
  const keys: TownPlaceKey[] = [
    "apartments",
    "library",
    "observatory",
    "post",
    "warehouse",
  ];
  expect([...all].sort()).toEqual(keys.sort());
  const { places, opened } = town(all);
  const ring = townCenterBuildings(places);
  expect(ring.map((action) => action.label)).toEqual([
    "Apartments",
    "Library",
    "Post office",
    "Observatory",
    "Warehouse",
  ]);
  // Counts stay on the buildings' signs.
  for (const action of ring) {
    expect(action.count).toBeUndefined();
    expect(`${action.label} ${action.detail ?? ""}`).not.toMatch(/\d/);
  }
  ring.find((action) => action.id === "library")!.run();
  expect(opened).toEqual(["library"]);
});

test("a place that opens nothing now is left out, and with none Buildings is too", () => {
  const { places } = town(["apartments"]);
  expect(townCenterBuildings(places).map((action) => action.id)).toEqual([
    "apartments",
  ]);
  const empty = withBuildingsAction(first, new TownPlaces());
  expect(empty.map((action) => action.id)).toEqual([
    "launch",
    "master",
    "room",
  ]);
});
