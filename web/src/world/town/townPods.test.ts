import { expect, test } from "bun:test";
import type { WorldPod } from "../pods";
import type { TownInput } from "./townLayout";
import type { TownModel } from "./townModel";
import { townPodStack } from "./townModel";
import {
  NO_TOWN_POD_STACKS,
  townPodStacks,
  townStackedInput,
} from "./townPods";

const pod = (rounds: string[]): WorldPod => ({
  key: "room\u0000#5",
  connectionId: "c",
  roomKey: "room",
  number: 5,
  slug: "fix",
  rounds: rounds.map((tabKey, index) => ({ round: index + 1, tabKey })),
  authorKeys: [],
  item: null,
  state: null,
});

function model(
  desks: Record<string, "working" | "blocked" | "done">,
  pinned: string[] = [],
) {
  return {
    desks: new Map(
      Object.keys(desks).map((key) => [
        key,
        { key, paneDevices: [{ agentKey: `${key}-agent` }] },
      ]),
    ),
    agents: new Map(
      Object.entries(desks).map(([key, semanticStatus]) => [
        `${key}-agent`,
        { semanticStatus },
      ]),
    ),
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
