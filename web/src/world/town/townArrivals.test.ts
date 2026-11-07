import { expect, test } from "bun:test";
import { AGENT_START_KEEP_MS, type AgentStart } from "../agentStarts";
import { TOWN_WALK_SPEED } from "./townActors";
import {
  TOWN_ARRIVAL_STAGGER_MS,
  TOWN_ARRIVAL_WALK_MS,
  TownArrivals,
  townAgentsByTerminal,
  townArrivalDone,
  townArrivalPath,
  townArrivalWalkMs,
  townPathLength,
  townPathPose,
} from "./townArrivals";
import { townBusRoute, townNearestStop } from "./townBus";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  TownGround,
} from "./townLayout";
import type { TownModel } from "./townModel";

let ids = 0;
const start = (
  terminalId: string,
  at = 0,
  from: AgentStart["from"] = "center",
): AgentStart => ({
  id: ++ids,
  connectionId: "c",
  generation: 1,
  terminalId,
  from,
  at,
});

/** Agents keyed `agent-<terminal>`, each on terminal `<terminal>`. */
const modelOf = (...terminals: string[]) =>
  ({
    agents: new Map(
      terminals.map((terminal) => [
        `agent-${terminal}`,
        {
          key: `agent-${terminal}`,
          currentTerminalRef: {
            connectionId: "c",
            generation: 1,
            nativeId: terminal,
          },
        },
      ]),
    ),
  }) as unknown as TownModel;

const plan = (
  arrivals: TownArrivals,
  starts: AgentStart[],
  model: TownModel,
  now: number,
  still = false,
) =>
  arrivals.update(starts, townAgentsByTerminal(model), () => 2000, now, still);

test("agents already in Town play nothing: only a confirmed start arrives", () => {
  // A reload: the page has no starts, whatever agents Town shows.
  const arrivals = new TownArrivals(new Set());
  expect(plan(arrivals, [], modelOf("t1", "t2"), 1000)).toBe(false);
  expect(arrivals.arrivals).toEqual([]);
  expect(arrivals.outside(1000)).toEqual([]);
  // World confirms t3; it arrives once Town shows it.
  const confirmed = start("t3", 1000);
  expect(plan(arrivals, [confirmed], modelOf("t1", "t2"), 1100)).toBe(false);
  expect(plan(arrivals, [confirmed], modelOf("t1", "t2", "t3"), 1500)).toBe(
    true,
  );
  expect(arrivals.arrivals).toEqual([
    {
      id: confirmed.id,
      agentKey: "agent-t3",
      from: "center",
      begin: 1500,
      end: 3500,
      still: false,
    },
  ]);
  // Outside until it reaches its front door, then in.
  expect(arrivals.outside(3499)).toEqual(["agent-t3"]);
  expect(arrivals.outside(3500)).toEqual([]);
  expect(arrivals.nextChange(1500)).toBe(3500);
  // At its desk, whatever its status, until its welcome is over.
  expect(arrivals.welcoming(1500)).toEqual(["agent-t3"]);
  expect(arrivals.welcoming(3500)).toEqual(["agent-t3"]);
  // It plays once, and is over after its welcome.
  expect(plan(arrivals, [confirmed], modelOf("t1", "t2", "t3"), 2000)).toBe(
    false,
  );
  const done = townArrivalDone(arrivals.arrivals[0]!);
  expect(arrivals.nextChange(3500)).toBe(done);
  expect(plan(arrivals, [confirmed], modelOf("t1", "t2", "t3"), done)).toBe(
    true,
  );
  expect(arrivals.arrivals).toEqual([]);
  expect(arrivals.welcoming(done)).toEqual([]);
});

test("a start never confirmed (failed or uncertain) has no arrival", () => {
  // The launcher notes only confirmed starts (launchConfirmedTerminal), so a
  // failed start's tab, even shown in Town, is just there.
  const arrivals = new TownArrivals(new Set());
  expect(plan(arrivals, [], modelOf("failed-tab"), 0)).toBe(false);
  expect(arrivals.outside(0)).toEqual([]);
});

test("simultaneous starts are staggered, each walking no longer than its own walk", () => {
  const arrivals = new TownArrivals(new Set());
  const starts = [start("a", 0), start("b", 0), start("c", 0)];
  plan(arrivals, starts, modelOf("a", "b", "c"), 100);
  expect(
    arrivals.arrivals.map(({ agentKey, begin, end }) => [agentKey, begin, end]),
  ).toEqual([
    ["agent-a", 100, 2100],
    ["agent-b", 100 + TOWN_ARRIVAL_STAGGER_MS, 2100 + TOWN_ARRIVAL_STAGGER_MS],
    [
      "agent-c",
      100 + 2 * TOWN_ARRIVAL_STAGGER_MS,
      2100 + 2 * TOWN_ARRIVAL_STAGGER_MS,
    ],
  ]);
  // Waiting their turn, all three are still outside.
  expect(arrivals.outside(150)).toEqual(["agent-a", "agent-b", "agent-c"]);
  // A later start queues behind the last one still to set off.
  const late = start("d", 200);
  plan(arrivals, [...starts, late], modelOf("a", "b", "c", "d"), 300);
  expect(arrivals.arrivals[arrivals.arrivals.length - 1]!.begin).toBe(
    100 + 3 * TOWN_ARRIVAL_STAGGER_MS,
  );
});

test("a start Town shows too late, or already played, never plays again", () => {
  const played = new Set<number>();
  const old = start("old", 0);
  const first = new TownArrivals(played);
  expect(plan(first, [old], modelOf("old"), AGENT_START_KEEP_MS)).toBe(false);
  // Returning to Town (a new mount, the same page) does not replay a start.
  const fresh = start("fresh", 0);
  plan(first, [fresh], modelOf("fresh"), 10);
  expect(first.arrivals).toHaveLength(1);
  const again = new TownArrivals(played);
  expect(plan(again, [old, fresh], modelOf("old", "fresh"), 20)).toBe(false);
  expect(again.arrivals).toEqual([]);
});

test("with reduced motion an arrival has no walk: the agent stays at its desk", () => {
  const arrivals = new TownArrivals(new Set());
  plan(arrivals, [start("a"), start("b")], modelOf("a", "b"), 0, true);
  expect(
    arrivals.arrivals.map(({ begin, end, still }) => [begin, end, still]),
  ).toEqual([
    [0, 0, true],
    [TOWN_ARRIVAL_STAGGER_MS, TOWN_ARRIVAL_STAGGER_MS, true],
  ]);
  expect(arrivals.outside(0)).toEqual([]);
  // Still kept at their desks for the highlight.
  expect(arrivals.welcoming(0)).toEqual(["agent-a", "agent-b"]);
});

test("one launched elsewhere arrives from its bus stop; one with no way in has no walk", () => {
  const arrivals = new TownArrivals(new Set());
  arrivals.update(
    [start("a", 0, "elsewhere"), start("b", 0)],
    townAgentsByTerminal(modelOf("a", "b")),
    (agentKey) => (agentKey === "agent-a" ? 1000 : null),
    0,
    false,
  );
  expect(
    arrivals.arrivals.map(({ from, begin, end }) => [from, end - begin]),
  ).toEqual([
    ["stop", 1000],
    ["center", 0],
  ]);
  expect(arrivals.outside(0)).toEqual(["agent-a"]);
});

const town = (hosts: Record<string, number>) => ({
  hosts: Object.keys(hosts).map((key, displayOrder) => ({ key, displayOrder })),
  rooms: Object.entries(hosts).map(([hostKey, count]) => ({
    key: `${hostKey}/room`,
    hostKey,
    order: 0,
    deskKeys: Array.from({ length: count }, (_, i) => `${hostKey}/t${i}`),
  })),
});

test("the way in runs along pavements and side roads to the front door, never through a building", () => {
  const towns = [
    { a: 2 },
    { a: 2, b: 3, c: 1 },
    Object.fromEntries([..."abcdefgh"].map((key) => [key, 1])),
  ];
  for (const shape of [TOWN_SHAPES.phone, TOWN_SHAPES.medium, TOWN_SHAPES.wide])
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      for (const building of layout.buildings) {
        const agent = {
          hostKey: building.hostKey,
          roomKey: `${building.hostKey}/room`,
        };
        const door = {
          x: building.entryX * T + 8,
          y: (building.y + 1) * T + 13,
        };
        for (const from of ["center", "stop"] as const) {
          const path = townArrivalPath(layout, route, agent, from)!;
          expect(path).not.toBeNull();
          const center = layout.center;
          expect(path[0]).toEqual(
            from === "center"
              ? {
                  x: (center.x + Math.floor(center.w / 2)) * T + 8,
                  y: (center.y + center.h - 1) * T + 13,
                }
              : townNearestStop(route, layout, building, agent.roomKey)!.wait,
          );
          expect(path[path.length - 1]).toEqual(door);
          for (let index = 1; index < path.length; index += 1) {
            const a = path[index - 1]!;
            const b = path[index]!;
            // Straight stretches along the grid.
            expect(a.x === b.x || a.y === b.y).toBe(true);
            const steps = Math.ceil(
              (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / 4,
            );
            for (let step = 0; step <= steps; step += 1) {
              const x = Math.floor((a.x + ((b.x - a.x) * step) / steps) / T);
              const y = Math.floor((a.y + ((b.y - a.y) * step) / steps) / T);
              // Into its own building only by its front door, at the end.
              if (x === building.entryX && y >= building.y) continue;
              const ground = layout.ground[y * layout.width + x];
              expect(
                ground !== TownGround.building && ground !== TownGround.facade,
              ).toBe(true);
            }
          }
        }
      }
    }
});

test("an arrival walks at walking pace and hurries along a long way", () => {
  const near = [
    { x: 0, y: 0 },
    { x: 76, y: 0 },
  ];
  expect(townArrivalWalkMs(near)).toBeCloseTo(1000);
  const far = [
    { x: 0, y: 0 },
    { x: 0, y: TOWN_WALK_SPEED * 60 },
  ];
  expect(townArrivalWalkMs(far)).toBe(TOWN_ARRIVAL_WALK_MS);
  const path = [
    { x: 0, y: 0 },
    { x: 0, y: 30 },
    { x: 50, y: 30 },
  ];
  expect(townPathLength(path)).toBe(80);
  expect(townPathPose(path, 15)).toMatchObject({ x: 0, y: 15, dir: "down" });
  expect(townPathPose(path, 40)).toMatchObject({
    x: 10,
    y: 30,
    dir: "right",
    walking: true,
  });
  expect(townPathPose(path, 80)).toEqual({
    x: 50,
    y: 30,
    dir: "up",
    frame: 0,
    walking: false,
  });
});
