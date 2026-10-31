import { expect, test } from "bun:test";
import { EMPTY_WORLD_SOURCES } from "../../worldSources";
import type { Pane, Tab, Workspace } from "../../../types";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
  type HerdrOfficeProjection,
} from "../../herdrOfficeProjection";
import type { WorldRuntimeConnection } from "../../runtimeStore";
import { terminalColorKey, type TerminalColors } from "../../terminalColor";
import type { DeskPins } from "../../useDeskPins";
import { buildWorldObject } from "../../worldObject";
import { townGeometryKey, townShapeFor } from "../townLayout";
import { townDeskColorTarget } from "../townModel";
import type { TownClock } from "./ports";
import {
  TOWN_REFLOW_IDLE_MS,
  TownScene,
  type TownSemanticInputs,
} from "./townScene";

/** A clock that moves only when the test advances it. */
function manualClock(start = 10_000) {
  let now = start;
  let wall = 1_700_000_000_000;
  let timers: { at: number; run: () => void }[] = [];
  const clock: TownClock = {
    now: () => now,
    wall: () => wall,
    after(ms, run) {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((entry) => entry !== timer);
      };
    },
  };
  return {
    clock,
    pending: () => timers.length,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers
          .filter((timer) => timer.at <= until)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        wall += next.at - now;
        now = next.at;
        next.run();
      }
      wall += until - now;
      now = until;
    },
  };
}

/** One synthetic host: each workspace with tabs of the given agent states. */
function office(
  rooms: Record<string, readonly string[]>,
): HerdrOfficeProjection {
  const workspaces: Workspace[] = Object.keys(rooms).map((id, index) => ({
    workspace_id: id,
    number: index + 1,
    label: id,
    focused: index === 0,
    pane_count: rooms[id]!.length,
    tab_count: rooms[id]!.length,
    active_tab_id: `${id}:t0`,
    agent_status: "working",
  }));
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  for (const [id, statuses] of Object.entries(rooms))
    statuses.forEach((status, index) => {
      const tabId = `${id}:t${index}`;
      tabs.push({
        tab_id: tabId,
        workspace_id: id,
        number: index + 1,
        label: `Tab ${index + 1}`,
        focused: index === 0,
        pane_count: 1,
        agent_status: status,
      });
      panes.push({
        pane_id: `${tabId}:p`,
        terminal_id: `term-${tabId}`,
        workspace_id: id,
        tab_id: tabId,
        focused: true,
        agent: "claude",
        agent_status: status,
        revision: 1,
      });
    });
  const connection: WorldRuntimeConnection = {
    connectionId: "studio",
    label: "studio",
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
  return projectWorldOffice(
    buildWorldObject([connection], "studio"),
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
}

const working = (count: number) => Array<string>(count).fill("working");
const NO_RELATIONS = { relations: [], places: new Map() };

function inputs(
  projection: HerdrOfficeProjection,
  rest: Partial<TownSemanticInputs> = {},
): TownSemanticInputs {
  return {
    projection,
    terminalColors: {},
    deskPins: {},
    relations: NO_RELATIONS,
    sources: EMPTY_WORLD_SOURCES,
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
