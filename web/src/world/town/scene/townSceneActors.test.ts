import { expect, test } from "bun:test";
import type { DeskPins } from "../../useDeskPins";
import { terminalColorKey } from "../../terminalColor";
import { townActorWorld, TownActors, type TownActorWorld } from "../townActors";
import { townShapeFor } from "../townLayout";
import { townDeskColorTarget } from "../townModel";
import { townRandom } from "../townSprites";
import { manualClock, town } from "./townScene.fixture";
import { TownScene, type TownSemantics } from "./townScene";
import {
  townActorDirty,
  townActorKeys,
  type TownActorKeys,
} from "./townSceneActors";

const STATUSES = ["working", "blocked", "done", "idle"] as const;

/** Two hosts of agents in the given states (alpha, beta at studio; gamma at lab). */
function towns(alpha: string[], beta: string[], gamma: string[]) {
  return town({
    studio: { alpha, beta },
    lab: { gamma, delta: ["working"] },
  });
}

function derive(
  scene: TownScene,
  projection: ReturnType<typeof towns>,
  deskPins: DeskPins = {},
): TownSemantics {
  return scene.derive({
    projection,
    terminalColors: {},
    deskPins,
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

/** Actors as plain data, to compare whole states. */
const snapshot = (actors: TownActors) =>
  JSON.stringify(
    [...actors.actors.values()]
      .map((actor) => ({ ...actor }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );

for (const reduced of [false, true])
  test(`reconciling only the dirty hosts moves every agent as a full reconciliation does${reduced ? " (reduced motion)" : ""}`, () => {
    const random = townRandom(0xac7);
    const pick = <T>(list: readonly T[]) =>
      list[Math.floor(random() * list.length)]!;
    const scene = new TownScene(manualClock().clock, () => {});
    const full = new TownActors();
    const scoped = new TownActors();
    let fullWorld: TownActorWorld | null = null;
    let scopedWorld: TownActorWorld | null = null;
    let keys: TownActorKeys | null = null;
    let skipped = 0;
    let alpha: string[] = ["working", "idle", "blocked"];
    const beta: string[] = ["working", "done"];
    const gamma: string[] = ["idle", "working", "working"];
    let pin = false;
    let mark: "summon" | "ask" | "none" = "none";
    for (let step = 0; step < 300; step += 1) {
      // One small change at a time: an agent's status, a mark or a pin, and
      // sometimes a room that grows or shrinks (which reflows the town).
      const roll = random();
      if (roll < 0.1)
        alpha = alpha.length === 3 ? [...alpha, ...alpha] : alpha.slice(0, 3);
      else if (roll < 0.15) pin = !pin;
      else if (roll < 0.25) mark = pick(["summon", "ask", "none"] as const);
      else {
        const list = pick([alpha, beta, gamma]);
        list[Math.floor(random() * list.length)] = pick(STATUSES);
      }
      const projection = towns([...alpha], [...beta], [...gamma]);
      const pinned: DeskPins = pin
        ? {
            [terminalColorKey(
              townDeskColorTarget(projection, projection.rooms[0]!.desks[0]!)!,
            )]: { cell: null },
          }
        : {};
      const semantics = derive(scene, projection, pinned);
      const agents = [...semantics.model.agents.keys()];
      const marked = agents[step % agents.length]!;
      const summoned = new Set(mark === "summon" ? [marked] : []);
      const asking = new Set(mark === "ask" ? [marked] : []);
      const next = townActorKeys(
        semantics.model,
        semantics.layout,
        summoned,
        asking,
      );
      const first = keys === null;
      const dirty = first ? null : townActorDirty(keys!, next);
      keys = next;
      fullWorld = townActorWorld(semantics.layout, semantics.model, fullWorld);
      scopedWorld = townActorWorld(
        semantics.layout,
        semantics.model,
        scopedWorld,
      );
      // Reduced motion makes every reconciliation instant, as the renderer does.
      full.sync(fullWorld, first || reduced, summoned, asking);
      scoped.sync(
        scopedWorld,
        first || reduced,
        summoned,
        asking,
        dirty ?? undefined,
      );
      if (dirty) skipped += semantics.layout.buildings.length - dirty.size;
      expect({ step, actors: snapshot(scoped) }).toEqual({
        step,
        actors: snapshot(full),
      });
      // Agents walk, stand up and sit between observations.
      const frames = Math.floor(random() * 90);
      for (let frame = 0; frame < frames; frame += 1) {
        full.step(reduced ? 10 : 1 / 60);
        scoped.step(reduced ? 10 : 1 / 60);
      }
      expect({ step, walked: snapshot(scoped) }).toEqual({
        step,
        walked: snapshot(full),
      });
    }
    // The walk skipped unchanged hosts, not only full reconciliations.
    expect(skipped).toBeGreaterThan(20);
  });

test("a status change reconciles only its host and builds no navigation", () => {
  const scene = new TownScene(manualClock().clock, () => {});
  const none = new Set<string>();
  const before = derive(scene, towns(["working"], ["working"], ["working"]));
  const after = derive(scene, towns(["blocked"], ["working"], ["working"]));
  const studio = before.layout.buildings.find((b) =>
    b.rooms.some(
      (room) =>
        before.model.rooms.get(room.key)?.workspaceRef.nativeId === "alpha",
    ),
  )!.hostKey;
  const keysBefore = townActorKeys(before.model, before.layout, none, none);
  const keysAfter = townActorKeys(after.model, after.layout, none, none);
  // Unchanged: nothing to reconcile.
  expect(townActorDirty(keysBefore, keysBefore)).toEqual(new Set());
  const dirty = townActorDirty(keysBefore, keysAfter);
  expect(dirty).toEqual(new Set([studio]));
  const actors = new TownActors();
  const world = townActorWorld(before.layout, before.model);
  actors.sync(world, true, none, none);
  expect(actors.reconciled).toBe(before.model.agents.size);
  const next = townActorWorld(after.layout, after.model, world);
  // Same buildings: every navigation grid is kept.
  expect(next.built).toEqual(new Set());
  for (const [hostKey, navigation] of next.navigation)
    expect(navigation).toBe(world.navigation.get(hostKey)!);
  actors.sync(next, false, none, none, dirty);
  const studioAgents = [...after.model.agents.values()].filter(
    (agent) => agent.hostKey === studio,
  ).length;
  expect(actors.reconciled).toBe(studioAgents);
  expect(studioAgents).toBeLessThan(after.model.agents.size);
});

test("summoning or asking an agent dirties only its host", () => {
  const scene = new TownScene(manualClock().clock, () => {});
  const semantics = derive(scene, towns(["working"], ["working"], ["working"]));
  const agent = [...semantics.model.agents.values()][0]!;
  const none = new Set<string>();
  const base = townActorKeys(semantics.model, semantics.layout, none, none);
  for (const [summoned, asking] of [
    [new Set([agent.key]), none],
    [none, new Set([agent.key])],
  ])
    expect(
      townActorDirty(
        base,
        townActorKeys(semantics.model, semantics.layout, summoned, asking),
      ),
    ).toEqual(new Set([agent.hostKey]));
});

test("a host that appears or goes away is dirty", () => {
  const before = new Map([["a", "1"]]);
  const after = new Map([["b", "1"]]);
  expect(townActorDirty(before, after)).toEqual(new Set(["a", "b"]));
});

test("a building whose navigation inputs change builds a new grid; others keep theirs", () => {
  const scene = new TownScene(manualClock().clock, () => {});
  const before = derive(scene, towns(["working"], ["working"], ["working"]));
  const world = townActorWorld(before.layout, before.model);
  expect(world.built.size).toBe(before.layout.buildings.length);
  const [first, second] = before.layout.buildings;
  const moved = {
    ...before.layout,
    buildings: [{ ...first!, plants: [] }, second!],
  };
  const next = townActorWorld(moved, before.model, world);
  expect(next.built).toEqual(new Set([first!.hostKey]));
  expect(next.navigation.get(second!.hostKey)).toBe(
    world.navigation.get(second!.hostKey)!,
  );
});

test("an agent changing seats at an unchanged desk dirties its host and lands where a full sync puts it", () => {
  const scene = new TownScene(manualClock().clock, () => {});
  const semantics = derive(scene, towns(["working"], ["working"], ["working"]));
  const none = new Set<string>();
  const [agentKey, seat] = [...semantics.model.agentSeats][0]!;
  const moved = {
    ...semantics.model,
    agentSeats: new Map([
      ...semantics.model.agentSeats,
      [agentKey, { ...seat, seat: seat.seat + 1 }],
    ]),
  };
  const before = townActorKeys(semantics.model, semantics.layout, none, none);
  const dirty = townActorDirty(
    before,
    townActorKeys(moved, semantics.layout, none, none),
  );
  const host = semantics.model.agents.get(agentKey)!.hostKey;
  expect(dirty).toEqual(new Set([host]));
  const world = townActorWorld(semantics.layout, semantics.model);
  const full = new TownActors();
  const scoped = new TownActors();
  full.sync(world, true, none, none);
  scoped.sync(world, true, none, none);
  const next = townActorWorld(semantics.layout, moved, world);
  full.sync(next, false, none, none);
  scoped.sync(next, false, none, none, dirty);
  expect(snapshot(scoped)).toEqual(snapshot(full));
});
