import { afterAll, beforeAll, expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { terminalColorKey, type TerminalColors } from "../terminalColor";
import type { DeskPins } from "../useDeskPins";
import { townShapeFor, type TownBuilding } from "./townLayout";
import { townDeskColorTarget, type TownModel } from "./townModel";
import {
  paintTownFacade,
  paintTownInterior,
  paintTownRoof,
  townChosenCarpet,
  townHostTheme,
} from "./townPaint";
import { buildTownSprites, townRandom } from "./townSprites";
import { manualClock, town, working } from "./scene/townScene.fixture";
import { TownScene } from "./scene/townScene";
import {
  townBakeDirty,
  townBakeKeys,
  type TownBakeKeys,
} from "./scene/townSceneBake";

/*
 * An independent check of the renderer's dirty sets: paint every building
 * with the renderer's own painters into canvases that record their drawing,
 * and require that baking only what the dirty sets name leaves every
 * building painted exactly as a full bake would. Any input a painter reads
 * that the bake keys miss leaves a stale building, and fails here.
 */

/** A canvas that records what is drawn on it, so paintings compare as text. */
class RecordingCanvas {
  width = 0;
  height = 0;
  readonly log: string[] = [];
  #context: unknown = null;
  getContext() {
    const log = this.log;
    this.#context ??= new Proxy(
      {},
      {
        get:
          (_, name: string) =>
          (...args: unknown[]) => {
            log.push(`${name}(${args.map(describe).join(",")})`);
            return name.startsWith("create")
              ? { pattern: args.map(describe) }
              : undefined;
          },
        set: (_, name: string, value: unknown) => {
          log.push(`${name}=${describe(value)}`);
          return true;
        },
      },
    );
    return this.#context;
  }
  /** What this canvas shows, as text. */
  painted(): string {
    return `${this.width}x${this.height}[${this.log.join(";")}]`;
  }
}

function describe(value: unknown): string {
  if (value instanceof RecordingCanvas) return value.painted();
  if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
  return JSON.stringify(value) ?? String(value);
}

const realDocument = globalThis.document;
beforeAll(() => {
  globalThis.document = {
    createElement: () => new RecordingCanvas(),
  } as unknown as Document;
});
afterAll(() => {
  globalThis.document = realDocument;
});

/** A building as the renderer bakes it: interior, façade and roof. */
function paint(
  model: TownModel,
  building: TownBuilding,
  sprites: ReturnType<typeof buildTownSprites>,
) {
  const host = model.hosts.get(building.hostKey);
  const theme = townHostTheme(
    building.hostKey,
    host?.deterministicSkin.themeIndex,
    model.placeColors.hosts.get(building.hostKey),
  );
  const canvases = [
    paintTownInterior(building, theme, {
      table: sprites.table,
      tableSmall: sprites.tableSmall,
      chair: sprites.chair,
      chairBack: sprites.chairBack,
      colorFor: (deskKey) => model.deskColors.get(deskKey) ?? "blue",
      carpetFor: (roomKey) =>
        townChosenCarpet(model.placeColors.rooms.get(roomKey)),
    }),
    paintTownFacade(building, theme),
    paintTownRoof(building, theme, host?.stale ?? false),
  ] as unknown as RecordingCanvas[];
  return canvases.map((canvas) => canvas.painted()).join("|");
}

/** The model with one host changed, as an observation of that host would. */
function withHost(
  model: TownModel,
  hostKey: string,
  change: (
    host: TownModel["hosts"] extends ReadonlyMap<string, infer H> ? H : never,
  ) => object,
): TownModel {
  return {
    ...model,
    hosts: new Map(
      [...model.hosts].map(([key, host]) => [
        key,
        key === hostKey ? { ...host, ...change(host) } : host,
      ]),
    ) as TownModel["hosts"],
  };
}

test("baking only the dirty buildings paints the town as a full bake does", () => {
  const sprites = buildTownSprites();
  const projections = {
    base: town({
      studio: { alpha: working(3), beta: working(2) },
      lab: { gamma: working(2), delta: working(1) },
    }),
    status: town({
      studio: { alpha: ["blocked", ...working(2)], beta: working(2) },
      lab: { gamma: working(2), delta: working(1) },
    }),
    seated: town({
      studio: { alpha: working(3), beta: ["working+", "working"] },
      lab: { gamma: working(2), delta: working(1) },
    }),
    grown: town({
      studio: { alpha: working(24), beta: working(2) },
      lab: { gamma: working(2), delta: working(1) },
    }),
  };
  const base = projections.base;
  const desk = (
    projection: HerdrOfficeProjection,
    workspace: string,
    index = 0,
  ) =>
    terminalColorKey(
      townDeskColorTarget(
        projection,
        projection.rooms.find((r) => r.workspaceRef.nativeId === workspace)!
          .desks[index]!,
      )!,
    );
  const colors: Record<string, TerminalColors> = {
    none: {},
    desk: { [desk(base, "alpha")]: "pink" },
    room: { "lab:gamma": "teal" },
    // Desks with their own colours: a room colour then changes only its carpet.
    gammaDesks: {
      [desk(base, "gamma")]: "pink",
      [desk(base, "gamma", 1)]: "pink",
    },
    carpet: {
      [desk(base, "gamma")]: "pink",
      [desk(base, "gamma", 1)]: "pink",
      "lab:gamma": "teal",
    },
    studioHost: { "@host:studio": "orange" },
    labHost: { "@host:lab": "purple" },
  };
  const pins: Record<string, DeskPins> = {
    none: {},
    pin: { [desk(base, "beta")]: { cell: { col: 0, row: 0 } } },
  };
  const hostChanges = ["none", "stale", "theme", "staleAndTheme"] as const;
  const scene = new TownScene(manualClock().clock, () => {});
  const random = townRandom(0xb4c3);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length)]!;
  let keys: TownBakeKeys | null = null;
  const baked = new Map<string, string>();
  let rebakes = 0;
  const seen = new Set<string>();
  for (let step = 0; step < 160; step += 1) {
    const projection = pick(Object.values(projections));
    const color = pick(Object.keys(colors));
    const pin = pick(Object.keys(pins));
    const change = pick(hostChanges);
    const derived = scene.derive({
      projection,
      terminalColors: colors[color]!,
      deskPins: pins[pin]!,
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
    // A host's own observation: staleness, or (as a new skin) its theme.
    const lab = derived.layout.buildings[1]!.hostKey;
    let model = derived.model;
    if (change === "stale" || change === "staleAndTheme")
      model = withHost(model, lab, () => ({ stale: true }));
    if (change === "theme" || change === "staleAndTheme")
      model = withHost(model, lab, (host) => ({
        deterministicSkin: {
          ...host.deterministicSkin,
          themeIndex: (host.deterministicSkin.themeIndex + 1) % 6,
        },
      }));
    seen.add(change);
    const next = townBakeKeys(model, derived.layout);
    const dirty = townBakeDirty(keys, next);
    keys = next;
    const full = new Map(
      derived.layout.buildings.map((b) => [
        b.hostKey,
        paint(model, b, sprites),
      ]),
    );
    if (dirty.scene) {
      baked.clear();
      for (const [hostKey, painted] of full) baked.set(hostKey, painted);
    } else
      for (const hostKey of dirty.buildings) {
        baked.set(hostKey, full.get(hostKey)!);
        rebakes += 1;
      }
    expect({ step, baked: [...baked.keys()] }).toEqual({
      step,
      baked: [...full.keys()],
    });
    for (const [hostKey, painted] of full)
      expect({ step, hostKey, same: baked.get(hostKey) === painted }).toEqual({
        step,
        hostKey,
        same: true,
      });
  }
  expect(seen.size).toBe(hostChanges.length);
  expect(rebakes).toBeGreaterThan(10);
});
