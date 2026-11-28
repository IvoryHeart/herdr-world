import { expect, test } from "bun:test";
import { townActorWorld, TownActors } from "./townActors";
import { layoutTown, TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_STATE_LIGHT,
  TOWN_WAITING_AMBER,
  townDeskLight,
  townLightPlan,
  townPresence,
  townWaitingPulse,
} from "./townLighting";
import { townModelFromProjection, type TownModel } from "./townModel";
import { office, town } from "./scene/townScene.fixture";

function scene(projection: ReturnType<typeof office>) {
  const model = townModelFromProjection(projection);
  const { layout } = layoutTown(model.input, "wide");
  return { model, layout };
}

/** Agents where their status sends them, already arrived. */
function arrived(
  layout: TownLayout,
  model: TownModel,
  asking: ReadonlySet<string> = new Set(),
  held: ReadonlySet<string> = new Set(),
) {
  const actors = new TownActors();
  actors.sync(
    townActorWorld(layout, model),
    true,
    new Set(),
    asking,
    undefined,
    new Set(),
    held,
  );
  return actors;
}

const finishActorMotion = (actors: TownActors) => {
  for (let i = 0; i < 4000 && actors.busy; i += 1) actors.step(1 / 30);
  expect(actors.busy).toBe(false);
};

const roomOf = (model: TownModel, layout: TownLayout, label: string) => {
  const key = [...model.rooms.values()].find((room) =>
    room.key.endsWith(`"${label}"]`),
  )!.key;
  return layout.buildings.flatMap((b) => b.rooms).find((r) => r.key === key)!;
};

const inside = (
  room: { x: number; y: number; w: number; h: number },
  area: { x: number; y: number; w: number; h: number },
) =>
  area.x >= room.x * T &&
  area.y >= room.y * T &&
  area.x + area.w <= (room.x + room.w) * T &&
  area.y + area.h <= (room.y + room.h) * T;

test("a room with work in it is lit and a quiet one stays dark", () => {
  const { model, layout } = scene(
    office({ busy: ["working", "idle"], quiet: ["idle", "idle"] }),
  );
  const busy = roomOf(model, layout, "busy");
  const quiet = roomOf(model, layout, "quiet");
  const plan = townLightPlan(
    layout,
    model,
    new Set(),
    townPresence(arrived(layout, model).actors.values()),
  );
  expect(plan.areas.some((area) => inside(busy, area))).toBe(true);
  expect(plan.areas.some((area) => inside(quiet, area))).toBe(false);
  // No desk light in the quiet room either: idle agents throw none.
  const inQuiet = (p: { x: number; y: number }) =>
    p.x >= quiet.x * T &&
    p.x <= (quiet.x + quiet.w) * T &&
    p.y >= quiet.y * T &&
    p.y <= (quiet.y + quiet.h) * T;
  expect(plan.points.filter(inQuiet)).toEqual([]);
});

test("each desk throws its most urgent agent's state colour", () => {
  const { model, layout } = scene(
    office({ room: ["working", "blocked", "done", "idle", "done+"] }),
  );
  const room = roomOf(model, layout, "room");
  const lights = room.cells
    .filter((cell) => cell.deskKey)
    .map((cell) => townDeskLight(model, cell.deskKey!, new Set()));
  expect(lights).toEqual(["working", "blocked", "done", null, "done"]);
  const colours = townLightPlan(layout, model).points.map((p) => p.color);
  expect(colours).toContain(TOWN_STATE_LIGHT.working);
  expect(colours).toContain(TOWN_STATE_LIGHT.blocked);
  expect(colours).toContain(TOWN_STATE_LIGHT.done);
  // Blue-white, amber and green.
  expect(TOWN_STATE_LIGHT.working & 0xff).toBeGreaterThan(0xf0);
  expect(TOWN_STATE_LIGHT.blocked >> 16).toBe(0xff);
  expect((TOWN_STATE_LIGHT.done >> 8) & 0xff).toBeGreaterThan(
    TOWN_STATE_LIGHT.done >> 16,
  );
});

test("a reception pulses amber only while someone waits on you", () => {
  const { model, layout } = scene(
    town({
      calm: { a: ["working", "done"] },
      waiting: { b: ["blocked", "idle"] },
    }),
  );
  const plan = townLightPlan(layout, model);
  expect(plan.waiting).toHaveLength(1);
  const lobby = plan.waiting[0]!;
  expect(lobby.color).toBe(TOWN_WAITING_AMBER);
  const building = layout.buildings.find((b) => b.hostKey.includes("waiting"))!;
  // Over the lobby: across the building's top, above its rooms.
  expect(lobby.x).toBeGreaterThanOrEqual(building.x * T);
  expect(lobby.x + lobby.w).toBeLessThanOrEqual((building.x + building.w) * T);
  expect(lobby.y).toBeGreaterThanOrEqual(building.y * T);
  expect(lobby.y + lobby.h).toBeLessThanOrEqual(
    Math.min(...building.rooms.map((room) => room.y)) * T + T,
  );
});

test("a stale host's cached town is dark", () => {
  const projection = town({ gone: { a: ["working", "blocked"] } });
  const model = townModelFromProjection(projection);
  const { layout } = layoutTown(model.input, "wide");
  const host = [...model.hosts.values()][0]!;
  const stale = {
    ...model,
    hosts: new Map([[host.key, { ...host, stale: true }]]),
  };
  const plan = townLightPlan(layout, stale);
  expect(plan.waiting).toEqual([]);
  const building = layout.buildings[0]!;
  const inBuilding = (p: { x: number; y: number }) =>
    p.x >= building.x * T &&
    p.x <= (building.x + building.w) * T &&
    p.y >= building.y * T &&
    p.y <= (building.y + building.h) * T;
  expect(plan.areas.filter(inBuilding)).toEqual([]);
  expect(plan.points.filter(inBuilding)).toEqual([]);
});

test("the waiting pulse moves with motion and holds steady without it", () => {
  const seen = new Set(
    [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => townWaitingPulse(t, true)),
  );
  expect(seen.size).toBeGreaterThan(3);
  for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(townWaitingPulse(t, false)).toBe(1);
});

test("an open question pulses its reception; a desk and room stay lit only while the agent stays there", () => {
  for (const status of ["idle", "working", "done"] as const) {
    const { model, layout } = scene(
      office({ room: [status], quiet: ["idle"] }),
    );
    const room = roomOf(model, layout, "room");
    const deskKey = room.cells.find((cell) => cell.deskKey)!.deskKey!;
    const agentKey = model.desks.get(deskKey)!.paneDevices[0]!.agentKey!;
    const asking = new Set([agentKey]);
    // It walked to reception: the lobby pulses, the desk and room are dark.
    const away = townPresence(arrived(layout, model, asking).actors.values());
    expect(townDeskLight(model, deskKey, asking, away)).toBeNull();
    const plan = townLightPlan(layout, model, asking, away);
    expect(plan.waiting).toHaveLength(1);
    expect(plan.waiting[0]!.color).toBe(TOWN_WAITING_AMBER);
    expect(plan.areas.some((area) => inside(room, area))).toBe(false);
    // Held at its desk (its reception does not take the mark): amber there.
    const held = townPresence(
      arrived(layout, model, asking, asking).actors.values(),
    );
    expect(townDeskLight(model, deskKey, asking, held)).toBe("blocked");
    const seated = townLightPlan(layout, model, asking, held);
    expect(seated.points.map((p) => p.color)).toContain(
      TOWN_STATE_LIGHT.blocked,
    );
    expect(seated.areas.some((area) => inside(room, area))).toBe(true);
    // The other room stays dark: its quiet agent asks nothing.
    const quiet = roomOf(model, layout, "quiet");
    expect(seated.areas.some((area) => inside(quiet, area))).toBe(false);
    // Answered, the question takes its light with it.
    const answered = townLightPlan(layout, model, new Set());
    expect(answered.waiting).toEqual([]);
    expect(townDeskLight(model, deskKey, new Set())).toBe(
      status === "idle" ? null : status,
    );
  }
});

test("light changes with the walk: a working agent lights its desk and room as it sits down", () => {
  const before = scene(office({ room: ["idle"] }));
  const after = scene(office({ room: ["working"] }));
  const { layout } = after;
  const room = roomOf(after.model, layout, "room");
  const deskKey = room.cells.find((cell) => cell.deskKey)!.deskKey!;
  const building = layout.buildings[0]!;
  const bar = building.lounge;
  const inBar = (area: { x: number; y: number; w: number; h: number }) =>
    inside(bar, area);
  const lit = (model: TownModel, actors: TownActors) => {
    const plan = townLightPlan(
      layout,
      model,
      new Set(),
      townPresence(actors.actors.values()),
    );
    return {
      room: plan.areas.some((area) => inside(room, area)),
      bar: plan.areas.some(inBar),
      desk: townDeskLight(
        model,
        deskKey,
        new Set(),
        townPresence(actors.actors.values()),
      ),
    };
  };
  // Idle: at the bar, which is lit; its desk and room are dark.
  const actors = arrived(layout, before.model);
  expect(lit(before.model, actors)).toEqual({
    room: false,
    bar: true,
    desk: null,
  });
  // It starts working: no light moves ahead of it.
  actors.sync(townActorWorld(layout, after.model), false);
  actors.step(1 / 30);
  expect(lit(after.model, actors)).toEqual({
    room: false,
    bar: false,
    desk: null,
  });
  finishActorMotion(actors);
  expect(lit(after.model, actors)).toEqual({
    room: true,
    bar: false,
    desk: "working",
  });
  // Its process is gone (World reads it idle): the desk and room go dark as
  // it stands up, and the bar lights when it gets there.
  actors.sync(townActorWorld(layout, before.model), false);
  actors.step(1 / 30);
  expect(lit(before.model, actors)).toEqual({
    room: false,
    bar: false,
    desk: null,
  });
  finishActorMotion(actors);
  expect(lit(before.model, actors)).toEqual({
    room: false,
    bar: true,
    desk: null,
  });
});

test("an agent with no status report sits at its desk unlit: never guessed working", () => {
  const { model, layout } = scene(office({ room: ["unknown"] }));
  const room = roomOf(model, layout, "room");
  const deskKey = room.cells.find((cell) => cell.deskKey)!.deskKey!;
  const actors = arrived(layout, model);
  expect([...townPresence(actors.actors.values()).seated]).toHaveLength(1);
  const plan = townLightPlan(
    layout,
    model,
    new Set(),
    townPresence(actors.actors.values()),
  );
  expect(
    townDeskLight(
      model,
      deskKey,
      new Set(),
      townPresence(actors.actors.values()),
    ),
  ).toBeNull();
  expect(plan.areas.some((area) => inside(room, area))).toBe(false);
});

test("a plain terminal asking a question lights its desk and reception", () => {
  const { model, layout } = scene(office({ room: ["idle"] }));
  const room = roomOf(model, layout, "room");
  const deskKey = room.cells.find((cell) => cell.deskKey)!.deskKey!;
  // The fixture seats agents only; take this one's away to leave a terminal.
  const device = model.desks.get(deskKey)!.paneDevices[0]!;
  delete (device as { agentKey?: string }).agentKey;
  const listed = model.projection.paneRoster.find(
    (entry) => entry.device.key === device.key,
  )!.device;
  delete (listed as { agentKey?: string }).agentKey;
  const asking = new Set([device.nodeId]);
  expect(townDeskLight(model, deskKey, new Set())).toBeNull();
  expect(townDeskLight(model, deskKey, asking)).toBe("blocked");
  expect(townLightPlan(layout, model).waiting).toEqual([]);
  expect(townLightPlan(layout, model, asking).waiting).toHaveLength(1);
});
