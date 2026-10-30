import { expect, test } from "bun:test";
import type { WorldPod } from "../pods";
import type { WorldAgentStatus } from "../worldObject";
import type { TownInput } from "./townLayout";
import type { TownModel } from "./townModel";
import { townPodStack } from "./townModel";
import {
  NO_TOWN_POD_STACKS,
  townPodStacks,
  townPodsKey,
  townStackedInput,
} from "./townPods";

const pod = (rounds: string[], slug = "fix"): WorldPod => ({
  key: "room\u0000#5",
  connectionId: "c",
  roomKey: "room",
  number: 5,
  slug,
  rounds: rounds.map((tabKey, index) => ({ round: index + 1, tabKey })),
  authorKeys: [],
  item: null,
  state: null,
});

/** One agent per desk; `more` adds agents beyond the desk's drawn seats. */
function model(
  desks: Record<string, WorldAgentStatus>,
  pinned: string[] = [],
  more: [string, WorldAgentStatus][] = [],
) {
  const agent = (deskKey: string, key: string, semanticStatus: string) =>
    [key, { key, deskKey, semanticStatus }] as const;
  return {
    desks: new Map(Object.keys(desks).map((key) => [key, { key }])),
    agents: new Map([
      ...Object.entries(desks).map(([key, status]) =>
        agent(key, `${key}-agent`, status),
      ),
      ...more.map(([key, status], index) =>
        agent(key, `${key}-more-${index}`, status),
      ),
    ]),
    projection: {
      paneRoster: Object.keys(desks).map((key) => ({
        device: { nodeId: `${key}-shell`, deskKey: key },
      })),
    },
    deskPins: new Map(pinned.map((key) => [key, { key, cell: null }])),
  } as unknown as TownModel;
}

test("earlier rounds stack behind the current round's table", () => {
  const stacks = townPodStacks(
    model({ r1: "done", r2: "done", r3: "working" }),
    [pod(["r1", "r2", "r3"])],
  );
  expect([...stacks.stacked]).toEqual(["r1", "r2"]);
  expect([...stacks.stacks]).toEqual([["r3", 2]]);
});

test("a round whose agent needs you, or a pinned one, keeps its own desk", () => {
  const stacks = townPodStacks(
    model({ r1: "blocked", r2: "done", r3: "working" }, ["r2"]),
    [pod(["r1", "r2", "r3"])],
  );
  expect(stacks).toBe(NO_TOWN_POD_STACKS);
});

test("a working earlier round keeps its own desk", () => {
  // A round-1 reviewer still finishing while round 2 runs.
  expect(
    townPodStacks(model({ r1: "working", r2: "working" }), [pod(["r1", "r2"])]),
  ).toBe(NO_TOWN_POD_STACKS);
});

test("an open ask from an earlier round keeps its desk until it is answered", () => {
  const idle = model({ r1: "idle", r2: "working" });
  const pods = [pod(["r1", "r2"])];
  // The asking agent is idle, not blocked; then a plain shell asks.
  expect(townPodStacks(idle, pods, new Set(["r1-agent"]))).toBe(
    NO_TOWN_POD_STACKS,
  );
  expect(townPodStacks(idle, pods, new Set(["r1-shell"]))).toBe(
    NO_TOWN_POD_STACKS,
  );
  expect([...townPodStacks(idle, pods, new Set()).stacked]).toEqual(["r1"]);
});

test("an agent beyond the desk's drawn seats still keeps it", () => {
  const busy = model({ r1: "done", r2: "working" }, [], [["r1", "blocked"]]);
  expect(townPodStacks(busy, [pod(["r1", "r2"])])).toBe(NO_TOWN_POD_STACKS);
});

test("renaming a round's branch changes the pods' key", () => {
  expect(townPodsKey([pod(["r1"], "old")])).not.toBe(
    townPodsKey([pod(["r1"], "new")]),
  );
});

test("one round has nothing to stack", () => {
  expect(townPodStacks(model({ r1: "working" }), [pod(["r1"])])).toBe(
    NO_TOWN_POD_STACKS,
  );
});

test("stacked desks leave the layout input with their seats", () => {
  const input: TownInput = {
    hosts: [{ key: "h", displayOrder: 0 }],
    rooms: [
      {
        key: "room",
        hostKey: "h",
        order: 0,
        deskKeys: ["a", "r1", "r2"],
        deskSeats: [1, 3, 2],
      },
    ],
  };
  expect(townStackedInput(input, new Set())).toBe(input);
  expect(townStackedInput(input, new Set(["r1"])).rooms[0]).toMatchObject({
    deskKeys: ["a", "r2"],
    deskSeats: [1, 2],
  });
});

test("at most two faded tables, the nearest least faded", () => {
  expect(townPodStack()).toEqual([]);
  expect(townPodStack(5)).toEqual([
    { dx: 8, dy: -10, alpha: 0.3 },
    { dx: 4, dy: -5, alpha: 0.45 },
  ]);
});
