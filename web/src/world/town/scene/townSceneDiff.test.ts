import { expect, test } from "bun:test";
import { townShapeFor } from "../townLayout";
import { manualClock, town, working } from "./townScene.fixture";
import { TownScene } from "./townScene";
import { TownSceneDiff, type TownSceneState } from "./townSceneDiff";

const none = new Set<string>();
const marks = (rest: Partial<TownSceneState> = {}): TownSceneState => ({
  selectedKey: null,
  hoverKey: null,
  completionSeenKeys: none,
  summonedKeys: none,
  openHostKey: null,
  calm: false,
  ...rest,
});

function derive(scene: TownScene, alpha: string[]) {
  return scene.derive({
    projection: town({
      studio: { alpha, beta: working(2) },
      lab: { gamma: working(2) },
    }),
    terminalColors: {},
    deskPins: {},
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

function setup() {
  const scene = new TownScene(manualClock().clock, () => {});
  const diff = new TownSceneDiff();
  const base = derive(scene, working(3));
  const studio = base.layout.buildings.find((b) =>
    b.rooms.some(
      (r) => base.model.rooms.get(r.key)?.workspaceRef.nativeId === "alpha",
    ),
  )!.hostKey;
  return { scene, diff, base, studio };
}

test("a renderer's first frame places and bakes everything", () => {
  const { diff, base } = setup();
  const { dirty } = diff.next(base.model, base.layout, marks());
  expect(dirty.first).toBe(true);
  expect(dirty.scene).toBe(true);
  expect(dirty.bake.scene).toBe(true);
  expect(dirty.actors).toEqual(
    new Set(base.layout.buildings.map((b) => b.hostKey)),
  );
});

test("an unchanged observation reconciles no agent and bakes nothing", () => {
  const { scene, diff, base } = setup();
  diff.next(base.model, base.layout, marks());
  // The same town observed again: new objects, the same content.
  const again = derive(scene, working(3));
  expect(again.model).not.toBe(base.model);
  const { dirty } = diff.next(again.model, again.layout, marks());
  expect(dirty).toEqual({
    first: false,
    scene: true,
    bake: { scene: false, buildings: new Set() },
    actors: new Set(),
  });
  // Nothing new at all: not even a scene frame.
  const same = diff.next(again.model, again.layout, marks());
  expect(same.dirty.scene).toBe(false);
  expect(same.dirty.actors).toEqual(new Set());
});

test("one agent's status reconciles only its host and bakes nothing", () => {
  const { scene, diff, base, studio } = setup();
  diff.next(base.model, base.layout, marks());
  const blocked = derive(scene, ["blocked", ...working(2)]);
  const { dirty } = diff.next(blocked.model, blocked.layout, marks());
  expect(dirty.actors).toEqual(new Set([studio]));
  expect(dirty.bake).toEqual({ scene: false, buildings: new Set() });
});

test("a summoned or asking mark reconciles only its agent's host", () => {
  const { diff, base, studio } = setup();
  diff.next(base.model, base.layout, marks());
  const agent = [...base.model.agents.values()].find(
    (entry) => entry.hostKey === studio,
  )!;
  const summoned = diff.next(
    base.model,
    base.layout,
    marks({ summonedKeys: new Set([agent.key]) }),
  );
  expect(summoned.dirty.scene).toBe(false);
  expect(summoned.dirty.actors).toEqual(new Set([studio]));
  const asking = diff.next(
    base.model,
    base.layout,
    marks({
      summonedKeys: summoned.state.summonedKeys,
      askingKeys: new Set([agent.key]),
    }),
  );
  expect(asking.dirty.actors).toEqual(new Set([studio]));
});

test("selection, hover and calm only ask for a frame", () => {
  const { diff, base } = setup();
  diff.next(base.model, base.layout, marks());
  const { dirty } = diff.next(
    base.model,
    base.layout,
    marks({ selectedKey: "x", hoverKey: "y", calm: true }),
  );
  expect(dirty).toEqual({
    first: false,
    scene: false,
    bake: { scene: false, buildings: new Set() },
    actors: new Set(),
  });
});

test("a reset makes the next frame a first frame again", () => {
  const { diff, base } = setup();
  diff.next(base.model, base.layout, marks());
  diff.reset();
  const { dirty } = diff.next(base.model, base.layout, marks());
  expect(dirty.first).toBe(true);
  expect(dirty.bake.scene).toBe(true);
});

test("a host's own change (stale) bakes its building", () => {
  const { diff, base } = setup();
  diff.next(base.model, base.layout, marks());
  const lab = base.layout.buildings.find(
    (b) =>
      !b.rooms.some(
        (r) => base.model.rooms.get(r.key)?.workspaceRef.nativeId === "alpha",
      ),
  )!.hostKey;
  const stale = {
    ...base.model,
    hosts: new Map(
      [...base.model.hosts].map(([key, host]) => [
        key,
        key === lab ? { ...host, stale: true } : host,
      ]),
    ),
  };
  const { dirty } = diff.next(stale, base.layout, marks());
  expect(dirty.bake.buildings).toEqual(new Set([lab]));
});
