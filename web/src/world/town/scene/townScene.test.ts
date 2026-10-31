import { expect, test } from "bun:test";
import type { WorldSourcesSnapshot } from "../../../../../shared/worldSources";
import type { HerdrOfficeProjection } from "../../herdrOfficeProjection";
import { terminalColorKey, type TerminalColors } from "../../terminalColor";
import type { DeskPins } from "../../useDeskPins";
import type { Relation } from "../../../../../shared/relations";
import type { TerminalPlace } from "../../relations";
import {
  layoutTown,
  townGeometryKey,
  townShapeFor,
  townShapeKey,
  type TownPlacementMemory,
} from "../townLayout";
import {
  townDeskColors,
  townDeskColorTarget,
  townDeskPins,
  townModelFromProjection,
  townPinnedCells,
  townPlaceColors,
} from "../townModel";
import { townTargets } from "../townTargets";
import { townTeams } from "../townTeams";
import { manualClock, office, working } from "./townScene.fixture";
import {
  TOWN_REFLOW_IDLE_MS,
  TownScene,
  type TownSemanticInputs,
} from "./townScene";

const NO_RELATIONS = { relations: [], places: new Map() };
const NO_SOURCES: WorldSourcesSnapshot = {
  observedAt: 0,
  refreshing: false,
  sources: [],
  items: [],
  links: [],
  actions: [],
};

function inputs(
  projection: HerdrOfficeProjection,
  rest: Partial<TownSemanticInputs> = {},
): TownSemanticInputs {
  return {
    projection,
    terminalColors: {},
    deskPins: {},
    relations: NO_RELATIONS,
    sources: NO_SOURCES,
    shape: townShapeFor(1440, 900),
    foldRevision: 0,
    ...rest,
  };
}

function setup() {
  const time = manualClock();
  let wakes = 0;
  const scene = new TownScene(time.clock, () => {
    wakes += 1;
  });
  return { time, scene, wakes: () => wakes };
}

// A room growing from 2 desks to 24 moves the rooms below it.
const small = office({ alpha: working(2), beta: working(2) });
const grown = office({ alpha: working(24), beta: working(2) });

test("a background reflow waits while the user presses, then for a pause", () => {
  const { time, scene, wakes } = setup();
  const before = scene.derive(inputs(small)).layout;
  scene.pointerDown();
  let shown = scene.derive(inputs(grown));
  expect(townGeometryKey(shown.placed)).not.toBe(townGeometryKey(before));
  expect(shown.holding).toBe(true);
  expect(shown.layout).toBe(before);
  // Still pressed long after the idle period: the hold stays, and it keeps
  // waking to look again.
  for (let step = 0; step < 5; step += 1) {
    time.advance(TOWN_REFLOW_IDLE_MS);
    shown = scene.derive(inputs(grown));
    expect(shown.layout).toBe(before);
  }
  expect(wakes()).toBeGreaterThanOrEqual(5);
  // Released: the quiet period still holds it.
  scene.pointerUp();
  time.advance(TOWN_REFLOW_IDLE_MS - 1);
  expect(scene.derive(inputs(grown)).layout).toBe(before);
  // After the pause, the grown town shows.
  time.advance(1);
  shown = scene.derive(inputs(grown));
  expect(shown.holding).toBe(false);
  expect(shown.layout).toBe(shown.placed);
});

test("a held reflow wakes the adapter a third of the pause later", () => {
  const { time, scene, wakes } = setup();
  scene.derive(inputs(small));
  scene.touch();
  expect(scene.derive(inputs(grown)).holding).toBe(true);
  time.advance(TOWN_REFLOW_IDLE_MS / 3 - 1);
  expect(wakes()).toBe(0);
  time.advance(1);
  expect(wakes()).toBe(1);
  // Each derive replaces the pending wake rather than adding one.
  scene.derive(inputs(grown));
  scene.derive(inputs(grown));
  expect(time.pending()).toBe(1);
});

test("without recent input a background reflow applies at once", () => {
  const { time, scene } = setup();
  scene.derive(inputs(small));
  scene.touch();
  time.advance(TOWN_REFLOW_IDLE_MS);
  const shown = scene.derive(inputs(grown));
  expect(shown.holding).toBe(false);
  expect(shown.layout).toBe(shown.placed);
  expect(time.pending()).toBe(0);
});

test("an explicit Fold or Expand applies during the quiet period, and the next background change waits again", () => {
  const { time, scene } = setup();
  scene.derive(inputs(small, { foldRevision: 1 }));
  scene.pointerDown();
  // An explicit request commits its admission and revision together.
  const expanded = scene.derive(inputs(grown, { foldRevision: 2 }));
  expect(expanded.holding).toBe(false);
  expect(expanded.layout).toBe(expanded.placed);
  // A later background change under the same press waits again.
  const regrown = office({ alpha: working(24), beta: working(24) });
  const later = scene.derive(inputs(regrown, { foldRevision: 2 }));
  expect(later.holding).toBe(true);
  expect(later.layout).toBe(expanded.layout);
  scene.pointerUp();
  time.advance(TOWN_REFLOW_IDLE_MS);
  expect(scene.derive(inputs(regrown, { foldRevision: 2 })).holding).toBe(
    false,
  );
});

test("a held layout is dropped once it names a desk that is gone", () => {
  const { scene } = setup();
  scene.derive(inputs(office({ alpha: working(24), beta: working(2) })));
  scene.pointerDown();
  // alpha shrinks (its desks vanish) and the geometry changes.
  const shrunk = scene.derive(inputs(small));
  expect(shrunk.holding).toBe(false);
  expect(shrunk.layout).toBe(shrunk.placed);
});

test("a new shape places the town at once, even while pressed", () => {
  const { scene } = setup();
  scene.derive(inputs(small));
  scene.pointerDown();
  const phone = scene.derive(inputs(grown, { shape: townShapeFor(390, 844) }));
  expect(phone.holding).toBe(false);
  expect(phone.layout).toBe(phone.placed);
});

test("unchanged inputs keep every derived object", () => {
  const { scene } = setup();
  const same = inputs(small);
  const first = scene.derive(same);
  const second = scene.derive({ ...same });
  expect(second.model).toBe(first.model);
  expect(second.layout).toBe(first.layout);
  expect(second.teams).toBe(first.teams);
  expect(second.targets).toBe(first.targets);
  expect(second.deskBadges).toBe(first.deskBadges);
});

test("a colour change repaints without placing the town again", () => {
  const { scene } = setup();
  const desk = small.rooms[0]!.desks[0]!;
  const key = terminalColorKey(townDeskColorTarget(small, desk)!);
  const plain = scene.derive(inputs(small));
  const colors: TerminalColors = { [key]: "pink" };
  const painted = scene.derive(inputs(small, { terminalColors: colors }));
  expect(painted.placed).toBe(plain.placed);
  expect(painted.model.deskColors.get(desk.key)).toBe("pink");
  // The same colours, in a new object, keep the same colour map.
  const again = scene.derive(
    inputs(small, { terminalColors: { [key]: "pink" } }),
  );
  expect(again.model.deskColors).toBe(painted.model.deskColors);
});

test("a desk pinned without a cell is saved once, at the cell it has", () => {
  const { scene } = setup();
  const desk = small.rooms[0]!.desks[1]!;
  const key = terminalColorKey(townDeskColorTarget(small, desk)!);
  const pins: DeskPins = { [key]: { cell: null } };
  const pinned = scene.derive(inputs(small, { deskPins: pins }));
  const placements = scene.pinPlacements(
    pinned.model.deskPins,
    pinned.layout,
    pinned.placed,
  );
  expect(placements).toHaveLength(1);
  expect(placements[0]!.pinKey).toBe(key);
  const cell = pinned.layout.buildings
    .flatMap((building) => building.rooms.flatMap((room) => room.cells))
    .find((entry) => entry.deskKey === desk.key)!;
  expect(placements[0]!.cell).toEqual({ col: cell.col, row: cell.row });
  // Not again while its save is in flight; again if the save ends unplaced.
  expect(
    scene.pinPlacements(pinned.model.deskPins, pinned.layout, pinned.placed),
  ).toHaveLength(0);
  scene.pinPlaced(key);
  expect(
    scene.pinPlacements(pinned.model.deskPins, pinned.layout, pinned.placed),
  ).toHaveLength(1);
  // A pin with its cell needs no save.
  const saved = scene.derive(
    inputs(small, {
      deskPins: { [key]: { cell: { col: cell.col, row: cell.row } } },
    }),
  );
  scene.pinPlaced(key);
  expect(
    scene.pinPlacements(saved.model.deskPins, saved.layout, saved.placed),
  ).toHaveLength(0);
});

test("blocked agents keep the time they became blocked until they are not", () => {
  const { time, scene } = setup();
  const waiting = office({ alpha: ["blocked", "working"], beta: ["blocked"] });
  const first = scene.derive(inputs(waiting));
  const since = new Map(first.blockedSince);
  expect(since.size).toBe(2);
  time.advance(60_000);
  const later = office({ alpha: ["blocked", "blocked"], beta: ["working"] });
  const second = scene.derive(inputs(later));
  const alphaFirst = [...since.keys()].find((key) =>
    later.roster.some(
      ({ agent }) => agent.key === key && agent.semanticStatus === "blocked",
    ),
  )!;
  // Still blocked: the original time stays, so queue order is by age.
  expect(second.blockedSince.get(alphaFirst)).toBe(since.get(alphaFirst)!);
  // Newly blocked: now. Unblocked: gone.
  expect(second.blockedSince.size).toBe(2);
  expect(
    [...second.blockedSince.values()].filter(
      (at) => at === since.get(alphaFirst)! + 60_000,
    ),
  ).toHaveLength(1);
});

test("dispose cancels a pending wake", () => {
  const { time, scene, wakes } = setup();
  scene.derive(inputs(small));
  scene.pointerDown();
  scene.derive(inputs(grown));
  expect(time.pending()).toBe(1);
  scene.dispose();
  time.advance(TOWN_REFLOW_IDLE_MS);
  expect(wakes()).toBe(0);
});

/* ---------- semantic equivalence with the previous TownCanvas ---------- */

/**
 * What TownCanvas derived before the scene model, composed from the same pure
 * modules without its identity caches: model with colours and pins, placement
 * with memory per shape, teams and accessible targets.
 */
function previousTownCanvas() {
  let memory: { shape: string; memory: TownPlacementMemory } | null = null;
  return (next: TownSemanticInputs) => {
    const { projection, terminalColors, deskPins, relations, shape } = next;
    const model = {
      ...townModelFromProjection(projection),
      deskColors: townDeskColors(projection, terminalColors),
      placeColors: townPlaceColors(projection, terminalColors),
      deskPins: townDeskPins(projection, deskPins),
    };
    const key = townShapeKey(shape);
    const placed = layoutTown(
      model.input,
      shape,
      memory?.shape === key ? memory.memory : new Map(),
      townPinnedCells(model.deskPins),
    );
    memory = { shape: key, memory: placed.memory };
    const teams = townTeams(
      model,
      placed.layout,
      relations.relations,
      relations.places,
    );
    return {
      model,
      placed: placed.layout,
      teams,
      targets: townTargets(model, placed.layout, teams.deskTeams),
    };
  };
}

const ROOMS = ["alpha", "beta", "gamma", "delta"];

/** Desks in `alpha` and `beta` joined by a manual group. */
function grouped(projection: HerdrOfficeProjection) {
  const ids = new Set(ROOMS);
  const ref = (tab: string) => ({
    connection_id: "studio",
    terminal_id: `term-${tab}`,
  });
  const place = (workspace: string, tab: string): TerminalPlace => ({
    connectionId: "studio",
    workspaceId: workspace,
    tabId: tab,
    workspaceIds: ids,
    paneId: `${tab}:p`,
  });
  const relation: Relation = {
    key: "pair",
    a: ref("alpha:t0"),
    b: ref("beta:t0"),
    evidence: [
      {
        kind: "manual",
        sor: "world",
        source: "group-1",
        observed_at: null,
        current: true,
      },
    ],
    strength: 1,
  };
  expect(projection.rooms.length).toBeGreaterThan(1);
  return {
    relations: [relation],
    places: new Map([
      ["studio\u0000term-alpha:t0", place("alpha", "alpha:t0")],
      ["studio\u0000term-beta:t0", place("beta", "beta:t0")],
    ]),
  };
}

test("the scene derives what TownCanvas derived, through a sequence of updates", () => {
  const wide = townShapeFor(1440, 900);
  const phone = townShapeFor(390, 844);
  const quiet = office({
    alpha: working(2),
    beta: working(2),
    gamma: working(2),
    delta: working(2),
  });
  const grownAlpha = office({
    alpha: ["blocked", ...working(23)],
    beta: working(2),
    gamma: working(2),
    delta: working(2),
  });
  const grownBeta = office({
    alpha: ["blocked", ...working(23)],
    beta: ["done", ...working(7)],
    gamma: working(2),
    delta: working(2),
  });
  const colors: TerminalColors = {
    "studio:alpha": "teal",
    "@host:studio": "pink",
    [terminalColorKey(
      townDeskColorTarget(grownAlpha, grownAlpha.rooms[1]!.desks[0]!)!,
    )]: "orange",
  };
  const relations = grouped(grownAlpha);
  const pinnedDesk = grownAlpha.rooms[2]!.desks[1]!;
  const pinKey = terminalColorKey(townDeskColorTarget(grownAlpha, pinnedDesk)!);
  const steps: TownSemanticInputs[] = [
    inputs(quiet, { shape: wide }),
    inputs(grownAlpha, { shape: wide, terminalColors: colors, relations }),
    inputs(grownAlpha, {
      shape: wide,
      terminalColors: colors,
      relations,
      deskPins: { [pinKey]: { cell: { col: 0, row: 0 } } },
    }),
    inputs(grownAlpha, { shape: phone, terminalColors: colors, relations }),
    inputs(grownBeta, { shape: wide, terminalColors: colors, relations }),
  ];
  const { scene } = setup();
  const previous = previousTownCanvas();
  for (const [index, step] of steps.entries()) {
    const now = scene.derive(step);
    const then = previous(step);
    const at = `step ${index}`;
    expect(now.holding, at).toBe(false);
    expect(now.layout, at).toBe(now.placed);
    expect(now.placed, at).toEqual(then.placed);
    expect(now.model.deskColors, at).toEqual(then.model.deskColors);
    expect(now.model.placeColors, at).toEqual(then.model.placeColors);
    expect(now.model.deskPins, at).toEqual(then.model.deskPins);
    expect(now.teams, at).toEqual(then.teams);
    expect(now.targets, at).toEqual(then.targets);
  }
});

test("the moved semantic records carry their content, not only their identity", () => {
  const { scene } = setup();
  const four = (alpha: readonly string[]) =>
    office({
      alpha,
      beta: working(2),
      gamma: working(2),
      delta: working(2),
    });
  const quiet = four(working(2));
  const grownAlpha = four(["blocked", ...working(23)]);
  const relations = grouped(grownAlpha);
  scene.derive(inputs(quiet));
  const shown = scene.derive(
    inputs(grownAlpha, {
      relations,
      terminalColors: { "studio:alpha": "teal", "@host:studio": "pink" },
    }),
  );
  // Placement memory: a live scene keeps its columns, unlike a fresh layout.
  const fresh = layoutTown(
    shown.model.input,
    townShapeFor(1440, 900),
    new Map(),
    new Map(),
  );
  expect(townGeometryKey(fresh.layout)).not.toBe(townGeometryKey(shown.placed));
  // Teams: the grouped desks share a team.
  const [alphaDesk, betaDesk] = [
    grownAlpha.rooms[0]!.desks[0]!.key,
    grownAlpha.rooms[1]!.desks[0]!.key,
  ];
  expect(shown.teams.deskTeams.get(alphaDesk)).toBeDefined();
  expect(shown.teams.deskTeams.get(alphaDesk)).toBe(
    shown.teams.deskTeams.get(betaDesk),
  );
  // Place colours: the room and the building take their chosen colours.
  expect(shown.model.placeColors.rooms.get(grownAlpha.rooms[0]!.key)).toBe(
    "teal",
  );
  expect(shown.model.placeColors.hosts.get(grownAlpha.hosts[0]!.key)).toBe(
    "pink",
  );
  // Targets: every desk and room, labelled and activatable.
  const desks = shown.targets.filter((target) => target.kind === "desk");
  expect(desks).toHaveLength(24 + 2 + 2 + 2);
  expect(desks.every((target) => target.canActivate)).toBe(true);
  const rooms = shown.targets.filter((target) => target.kind === "room");
  expect(rooms.map((target) => target.label.split(",")[0])).toEqual([
    "Room alpha",
    "Room beta",
    "Room gamma",
    "Room delta",
  ]);
  const waiting = shown.targets.find(
    (target) => target.kind === "agent" && target.label.includes("needs input"),
  );
  expect(waiting).toBeDefined();
});
