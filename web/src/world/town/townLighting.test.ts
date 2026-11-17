import { expect, test } from "bun:test";
import { layoutTown, TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_STATE_LIGHT,
  TOWN_WAITING_AMBER,
  townDeskLight,
  townLightPlan,
  townRoomLit,
  townWaitingPulse,
} from "./townLighting";
import { townModelFromProjection, type TownModel } from "./townModel";
import { office, town } from "./scene/townScene.fixture";

function scene(projection: ReturnType<typeof office>) {
  const model = townModelFromProjection(projection);
  const { layout } = layoutTown(model.input, "wide");
  return { model, layout };
}

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
  expect(townRoomLit(model, busy.key)).toBe(true);
  expect(townRoomLit(model, quiet.key)).toBe(false);
  const plan = townLightPlan(layout, model);
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
    .map((cell) => townDeskLight(model, cell.deskKey!));
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
