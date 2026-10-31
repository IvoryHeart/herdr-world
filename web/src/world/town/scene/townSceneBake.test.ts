import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../../herdrOfficeProjection";
import { terminalColorKey, type TerminalColors } from "../../terminalColor";
import type { DeskPins } from "../../useDeskPins";
import { townShapeFor, type TownLayout } from "../townLayout";
import { townDeskColorTarget, type TownModel } from "../townModel";
import { townRandom } from "../townSprites";
import { manualClock, town, working } from "./townScene.fixture";
import { TownScene, type TownSemantics } from "./townScene";
import {
  townActorViewsToDrop,
  townBakeDirty,
  townBakeKeys,
  type TownBakeKeys,
} from "./townSceneBake";

/** The renderer's whole-world key before dirty sets: any change rebuilt all. */
function previousKey(model: TownModel, layout: TownLayout) {
  const places = model.placeColors;
  const deskColor = (key: string) => model.deskColors.get(key) ?? "blue";
  return `${[...places.rooms].join(",")}/${[...places.hosts].join(",")}/${layout.width}x${layout.height}:${layout.buildings.map((b) => `${b.hostKey}@${b.x},${b.y},${b.w},${b.h}:${b.rooms.map((r) => r.cells.map((c) => (c.deskKey ? `${c.deskKey}#${c.seats}#${deskColor(c.deskKey)}${model.deskPins.has(c.deskKey) ? "#pin" : ""}` : "-")).join(",")).join("|")}`).join(";")}`;
}

const base = () =>
  town({
    studio: { alpha: working(3), beta: working(2) },
    lab: { gamma: working(2), delta: working(1) },
  });
const blocked = () =>
  town({
    studio: { alpha: ["blocked", ...working(2)], beta: working(2) },
    lab: { gamma: working(2), delta: working(1) },
  });
const grown = () =>
  town({
    studio: { alpha: working(24), beta: working(2) },
    lab: { gamma: working(2), delta: working(1) },
  });

const deskKey = (projection: HerdrOfficeProjection, workspace: string) => {
  const room = projection.rooms.find(
    (entry) => entry.workspaceRef.nativeId === workspace,
  )!;
  return terminalColorKey(townDeskColorTarget(projection, room.desks[0]!)!);
};

/** Each change the renderer may see, by name. */
function variants() {
  const projection = base();
  const studioDesk = deskKey(projection, "alpha");
  const variants: Record<
    string,
    {
      projection: HerdrOfficeProjection;
      colors: TerminalColors;
      pins: DeskPins;
    }
  > = {
    base: { projection, colors: {}, pins: {} },
    status: { projection: blocked(), colors: {}, pins: {} },
    deskColor: { projection, colors: { [studioDesk]: "pink" }, pins: {} },
    roomColor: { projection, colors: { "lab:gamma": "teal" }, pins: {} },
    hostColor: { projection, colors: { "@host:lab": "orange" }, pins: {} },
    pin: {
      projection,
      colors: {},
      pins: { [studioDesk]: { cell: { col: 0, row: 0 } } },
    },
    grown: { projection: grown(), colors: {}, pins: {} },
  };
  return variants;
}

/** What the renderer is handed for a variant, through the scene model. */
function derive(
  scene: TownScene,
  variant: ReturnType<typeof variants>[string],
): TownSemantics {
  return scene.derive({
    projection: variant.projection,
    terminalColors: variant.colors,
    deskPins: variant.pins,
    relations: { relations: [], places: new Map() },
    sources: {
      observedAt: 0,
      refreshing: false,
      sources: [],
      items: [],
      links: [],
      actions: [],
    },
    shape: townShapeFor(1440, 900),
    foldRevision: 0,
  });
}

const hostOf = (semantics: TownSemantics, workspace: string) =>
  semantics.layout.buildings.find((building) =>
    building.rooms.some(
      (room) =>
        semantics.model.rooms.get(room.key)?.workspaceRef.nativeId ===
        workspace,
    ),
  )!.hostKey;

function dirtyAfter(from: string, to: string) {
  const all = variants();
  const scene = new TownScene(manualClock().clock, () => {});
  const before = derive(scene, all[from]!);
  const after = derive(scene, all[to]!);
  return {
    before,
    after,
    dirty: townBakeDirty(
      townBakeKeys(before.model, before.layout),
      townBakeKeys(after.model, after.layout),
    ),
  };
}

test("each change bakes only what it touches", () => {
  const same = dirtyAfter("base", "base");
  expect(same.dirty).toEqual({ scene: false, buildings: new Set() });
  // Agent status is drawn each frame, never baked.
  expect(dirtyAfter("base", "status").dirty).toEqual({
    scene: false,
    buildings: new Set(),
  });
  const studio = hostOf(same.after, "alpha");
  const lab = hostOf(same.after, "gamma");
  expect(studio).not.toBe(lab);
  for (const [change, host] of [
    ["deskColor", studio],
    ["pin", studio],
    ["roomColor", lab],
    ["hostColor", lab],
  ] as const)
    expect({ change, ...dirtyAfter("base", change).dirty }).toEqual({
      change,
      scene: false,
      buildings: new Set([host]),
    });
  // A room that grows moves its building's walls: the whole scene.
  expect(dirtyAfter("base", "grown").dirty.scene).toBe(true);
  // Nothing baked before: the first scene is built whole.
  const first = townBakeDirty(
    null,
    townBakeKeys(same.after.model, same.after.layout),
  );
  expect(first.scene).toBe(true);
});

test("dirty sets bake exactly when the old whole-world key rebuilt", () => {
  const names = Object.keys(variants());
  for (const from of names)
    for (const to of names) {
      const { before, after, dirty } = dirtyAfter(from, to);
      const old =
        previousKey(before.model, before.layout) !==
        previousKey(after.model, after.layout);
      const baked = dirty.scene || dirty.buildings.size > 0;
      expect({ from, to, baked }).toEqual({ from, to, baked: old });
    }
});

test("baking only the dirty parts keeps every building as a full bake would", () => {
  const all = variants();
  const names = Object.keys(all);
  const random = townRandom(0x5eed);
  const scene = new TownScene(manualClock().clock, () => {});
  let keys: TownBakeKeys | null = null;
  /** What a recording renderer last baked, by host. */
  const baked = new Map<string, string>();
  let rebakes = 0;
  for (let step = 0; step < 200; step += 1) {
    const name = names[Math.floor(random() * names.length)]!;
    const semantics = derive(scene, all[name]!);
    const next = townBakeKeys(semantics.model, semantics.layout);
    const dirty = townBakeDirty(keys, next);
    if (dirty.scene) {
      baked.clear();
      for (const [host, key] of next.buildings) baked.set(host, key);
    } else
      for (const host of dirty.buildings) {
        baked.set(host, next.buildings.get(host)!);
        rebakes += 1;
      }
    keys = next;
    expect(baked).toEqual(new Map(next.buildings));
  }
  // The walk exercised single-building bakes, not only whole scenes.
  expect(rebakes).toBeGreaterThan(10);
});

test("a room moved inside an unchanged building is baked again", () => {
  const { after } = dirtyAfter("base", "base");
  const keys = townBakeKeys(after.model, after.layout);
  const [first] = after.layout.buildings;
  const moved: TownLayout = {
    ...after.layout,
    buildings: after.layout.buildings.map((building) =>
      building === first
        ? {
            ...building,
            rooms: building.rooms.map((room, index) =>
              index === 0 ? { ...room, y: room.y + 1 } : room,
            ),
          }
        : building,
    ),
  };
  expect(townBakeDirty(keys, townBakeKeys(after.model, moved))).toEqual({
    scene: false,
    buildings: new Set([first!.hostKey]),
  });
});

test("a room's carpet alone, a desk's seats, the town's size and a building's walls each bake", () => {
  const { after } = dirtyAfter("base", "base");
  const { model, layout } = after;
  const keys = townBakeKeys(model, layout);
  const [first] = layout.buildings;
  const room = first!.rooms[0]!;
  // A carpet colour whose desks keep their own colours.
  const carpeted = {
    ...model,
    placeColors: {
      ...model.placeColors,
      rooms: new Map([...model.placeColors.rooms, [room.key, "teal" as const]]),
    },
  };
  expect(townBakeDirty(keys, townBakeKeys(carpeted, layout))).toEqual({
    scene: false,
    buildings: new Set([first!.hostKey]),
  });
  const withBuilding = (change: (b: typeof first) => typeof first) => ({
    ...layout,
    buildings: layout.buildings.map((b) => (b === first ? change(b)! : b)),
  });
  const seated = withBuilding((b) => ({
    ...b!,
    rooms: b!.rooms.map((r, index) =>
      index === 0
        ? {
            ...r,
            cells: r.cells.map((c) =>
              c.deskKey && c === r.cells.find((e) => e.deskKey)
                ? { ...c, seats: c.seats + 1 }
                : c,
            ),
          }
        : r,
    ),
  }));
  expect(townBakeDirty(keys, townBakeKeys(model, seated))).toEqual({
    scene: false,
    buildings: new Set([first!.hostKey]),
  });
  const wider = { ...layout, width: layout.width + 1 };
  expect(townBakeDirty(keys, townBakeKeys(model, wider)).scene).toBe(true);
  const shifted = withBuilding((b) => ({ ...b!, x: b!.x + 1 }));
  expect(townBakeDirty(keys, townBakeKeys(model, shifted)).scene).toBe(true);
});

test("a host turning stale or taking another theme bakes its building", () => {
  const { after } = dirtyAfter("base", "base");
  const { model, layout } = after;
  const keys = townBakeKeys(model, layout);
  const lab = hostOf(after, "gamma");
  const changed = (change: (host: object) => object) => ({
    ...model,
    hosts: new Map(
      [...model.hosts].map(([key, host]) => [
        key,
        key === lab ? { ...host, ...change(host) } : host,
      ]),
    ) as TownModel["hosts"],
  });
  for (const next of [
    changed(() => ({ stale: true })),
    changed(() => {
      const skin = model.hosts.get(lab)!.deterministicSkin;
      return {
        deterministicSkin: { ...skin, themeIndex: (skin.themeIndex + 1) % 6 },
      };
    }),
  ])
    expect(townBakeDirty(keys, townBakeKeys(next, layout))).toEqual({
      scene: false,
      buildings: new Set([lab]),
    });
});

test("baking one building again drops only its own agents' sprites", () => {
  const hosts = new Map([
    ["a1", "studio"],
    ["a2", "lab"],
    ["a3", "studio"],
  ]);
  expect(
    townActorViewsToDrop(
      ["a1", "a2", "a3", "gone"],
      (key) => hosts.get(key),
      "studio",
    ),
  ).toEqual(["a1", "a3", "gone"]);
  expect(
    townActorViewsToDrop(["a1", "a2"], (key) => hosts.get(key), "lab"),
  ).toEqual(["a2"]);
});
