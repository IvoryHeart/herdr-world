import { expect, test } from "bun:test";
import { Container } from "pixi.js";
import type { TownBakeKeys } from "./scene/townSceneBake";
import { diagnostics } from "./townDiagnostics";
import type { TownLayout } from "./townLayout";
import {
  createTownTopology,
  type TownTopologyContext,
} from "./townRendererTopology";
import {
  TOWN_HOST_RISE_DELAY,
  TOWN_HOST_RISE_SECONDS,
  townRisePose,
} from "./townTransition";

/*
 * A host's building that is still rising when it is rebaked (a desk
 * changes) or moved (another host comes or goes) rises on from the height
 * it was drawn at, and so does its replacement; one that leaves sinks from
 * there. Its drawing is placed by hand here, as a bake would leave it.
 */

type Building = TownLayout["buildings"][number];
const a = { hostKey: "a", x: 2, y: 2, w: 20, h: 15 } as Building;
const b = { hostKey: "b", x: 26, y: 2, w: 20, h: 15 } as Building;

function arriving() {
  let layout = { buildings: [a] } as unknown as TownLayout;
  const topology = createTownTopology({
    landLayer: new Container(),
    groundLayer: new Container(),
    sceneLayer: new Container(),
    stats: diagnostics(),
    model: () => null,
    layout: () => layout,
    deskColor: () => "blue",
    carpetFor: () => undefined,
    dropActors: () => {},
    onBuilt: () => {},
    dust: () => {},
  } as unknown as TownTopologyContext);
  const keys = {} as TownBakeKeys;
  topology.begin(keys, false);
  const change = (next: Building[]) => {
    layout = { buildings: next } as unknown as TownLayout;
    topology.begin(keys, false);
  };
  // `b` is ticked: its building is drawn rising.
  change([a, b]);
  const view = {
    ...b,
    container: new Container(),
    interior: new Container(),
    dim: new Container(),
    pods: [],
    textures: [],
    roofAlpha: 1,
    motion: {
      dx: 0,
      dy: 0,
      enter: true,
      crossfade: false,
      t: 0,
      rise: TOWN_HOST_RISE_DELAY,
      seconds: TOWN_HOST_RISE_DELAY + TOWN_HOST_RISE_SECONDS,
    },
  };
  (topology.buildings as unknown[]).push(view);
  (topology.byHost as Map<string, unknown>).set(b.hostKey, view);
  // 250 ms after it was ticked: five 50 ms frames, a twelfth of its rise.
  for (let i = 0; i < 5; i += 1) topology.step(0.05);
  return { topology, view, change };
}

/** Its height `seconds` after it was ticked. */
const heightAt = (seconds: number) =>
  townRisePose((seconds - TOWN_HOST_RISE_DELAY) / TOWN_HOST_RISE_SECONDS).sy;

test("a building rebaked while it rises rises on, and so does its replacement", () => {
  const { topology, view } = arriving();
  const before = view.container.scale.y;
  expect(before).toBeCloseTo(heightAt(0.25), 5);
  expect(before).toBeLessThan(0.5);

  topology.replaceBuilding(b.hostKey, false);
  // Neither the leaving drawing nor its replacement pops to full height.
  expect(view.container.scale.y).toBe(before);
  // The replacement's plaques wait for it to stand, as they did.
  expect(topology.motion(b.hostKey)?.alpha).toBe(0);
  topology.step(0.05);
  expect(view.container.scale.y).toBeCloseTo(heightAt(0.3), 5);
  expect(view.container.scale.y).toBeGreaterThan(before);
});

test("a building moved while it rises rises on as it glides", () => {
  const { topology, view, change } = arriving();
  const before = view.container.scale.y;
  // Another host arrives before it: `b` moves along to make room.
  const c = { hostKey: "c", x: 2, y: 2, w: 20, h: 15 } as Building;
  change([c, { ...a, x: 26 }, { ...b, x: 50 }]);
  topology.replaceBuilding(b.hostKey, false);
  expect(view.container.scale.y).toBe(before);
  expect(topology.motion(b.hostKey)?.alpha).toBe(0);
  topology.step(0.05);
  expect(view.container.scale.y).toBeCloseTo(heightAt(0.3), 5);
});

test("a building that leaves while it rises sinks from where it was", () => {
  const { topology, view, change } = arriving();
  const before = view.container.scale.y;
  change([a]);
  topology.removeBuilding(b.hostKey, false);
  expect(view.container.scale.y).toBe(before);
  let lowest = before;
  for (let i = 0; i < 20; i += 1) {
    topology.step(0.05);
    if (view.container.destroyed) break;
    // It never springs up to full height on its way down.
    expect(view.container.scale.y).toBeLessThan(1);
    lowest = Math.min(lowest, view.container.scale.y);
  }
  expect(lowest).toBeLessThan(before);
  expect(view.container.destroyed).toBe(true);
});

test("a drawing rebaked while it rises stays under its replacement until the rise ends", () => {
  const { topology, view, change } = arriving();
  // A desk changes 250 ms into the rise, with no host coming or going: the
  // replacement fades in over the rest of the rise (until 0.8 s), so the old
  // drawing must stay under it as long, not only for a plain rebake's fade.
  change([a, b]);
  topology.replaceBuilding(b.hostKey, false);
  let elapsed = 0.25;
  while (elapsed < 0.75) {
    topology.step(0.05);
    elapsed += 0.05;
    expect(view.container.destroyed).toBe(false);
  }
  expect(view.container.scale.y).toBeCloseTo(heightAt(elapsed), 5);
  topology.step(0.05);
  topology.step(0.05);
  expect(view.container.destroyed).toBe(true);
});
