import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "../board/boardFixture";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { townActorWorld, TownActors } from "./townActors";
import { layoutTown } from "./townLayout";
import type { TownModel } from "./townModel";
import { townReceptionBoard } from "./townReception";
import {
  TOWN_RECEPTION_DEFAULT,
  TOWN_RECEPTION_MARKS,
  parseTownReceptionFilter,
  townReceptionHeld,
  townReceptionIsDefault,
  townReceptionMark,
  townReceptionTakes,
  townReceptionTakesAll,
  withTownReceptionAll,
  withTownReceptionMarks,
  withTownReceptionReset,
  type TownReceptionMark,
} from "./townReceptionFilter";

/** Every set of marks a reception can take: all eight. */
const SUBSETS: TownReceptionMark[][] = Array.from({ length: 8 }, (_, bits) =>
  TOWN_RECEPTION_MARKS.filter((_, i) => bits & (1 << i)),
);

test("the default reception takes every mark, as reception always did", () => {
  expect(TOWN_RECEPTION_DEFAULT.default).toEqual(["blocked", "ask", "done"]);
  for (const stored of [undefined, null, 7, "x", {}, { default: "done" }])
    expect(parseTownReceptionFilter(stored)).toEqual(TOWN_RECEPTION_DEFAULT);
  expect(townReceptionTakes(TOWN_RECEPTION_DEFAULT, "c1")).toEqual(
    new Set(TOWN_RECEPTION_MARKS),
  );
  const agents = ["blocked", "done", "idle", "working"].map((status, i) => ({
    key: `a${i}`,
    hostKey: "h",
    semanticStatus: status,
  }));
  expect(
    townReceptionHeld(agents, new Set(["a2"]), townReceptionTakesAll).size,
  ).toBe(0);
});

test("a change applies to its own building unless it applies to all buildings", () => {
  // By default a change is this building's alone.
  let filter = withTownReceptionMarks(TOWN_RECEPTION_DEFAULT, "c1", [
    "blocked",
    "ask",
  ]);
  expect(filter.default).toEqual(TOWN_RECEPTION_MARKS);
  expect(townReceptionTakes(filter, "c1")).toEqual(new Set(["blocked", "ask"]));
  expect(townReceptionTakes(filter, "c2")).toEqual(
    new Set(TOWN_RECEPTION_MARKS),
  );
  filter = withTownReceptionMarks(filter, "c2", ["done", "blocked"]);
  expect(townReceptionTakes(filter, "c2")).toEqual(
    new Set(["blocked", "done"]),
  );
  // Stored and read back, the setting is the same; unknown marks drop out.
  const stored = JSON.parse(JSON.stringify(filter));
  stored.hosts.c3 = ["done", "elsewhere"];
  expect(parseTownReceptionFilter(stored).hosts).toEqual({
    c1: ["blocked", "ask"],
    c2: ["blocked", "done"],
    c3: ["done"],
  });
  // Reset for this building: it takes everything again, others keep theirs.
  filter = withTownReceptionReset(filter, "c2", false);
  expect(filter.hosts).toEqual({ c1: ["blocked", "ask"] });
  // Apply to all buildings: one World default, no building's own setting.
  filter = withTownReceptionAll(["ask", "blocked"]);
  expect(filter).toEqual({ default: ["blocked", "ask"], hosts: {} });
  for (const id of ["c1", "c2", "c9"])
    expect(townReceptionTakes(filter, id)).toEqual(new Set(["blocked", "ask"]));
  // A building set back to the World default keeps no setting of its own.
  filter = withTownReceptionMarks(filter, "c1", ["done"]);
  filter = withTownReceptionMarks(filter, "c1", ["blocked", "ask"]);
  expect(filter.hosts).toEqual({});
  // Reset for every building restores the default everywhere.
  filter = withTownReceptionMarks(filter, "c2", ["done"]);
  filter = withTownReceptionReset(filter, "c2", true);
  expect(townReceptionIsDefault(filter)).toBe(true);
});

test("an agent's reception mark is the one its bubble shows", () => {
  expect(townReceptionMark("blocked", true)).toBe("blocked");
  expect(townReceptionMark("done", true)).toBe("ask");
  expect(townReceptionMark("idle", true)).toBe("ask");
  expect(townReceptionMark("done", false)).toBe("done");
  expect(townReceptionMark("working", false)).toBeNull();
  expect(townReceptionMark("idle", false)).toBeNull();
});

/** One building: an agent per state, each at its own desk. */
function town() {
  const statuses: Record<string, string> = {
    blocked: "blocked",
    asking: "idle",
    "asking-done": "done",
    done: "done",
    "done-2": "done",
    working: "working",
    idle: "idle",
  };
  const asking = new Set(["asking", "asking-done"]);
  const keys = Object.keys(statuses);
  const deskKeys = keys.map((_, i) => `room/desk-${i}`);
  const { layout } = layoutTown(
    {
      hosts: [{ key: "host", displayOrder: 0 }],
      rooms: [{ key: "room", hostKey: "host", order: 0, deskKeys }],
    },
    "wide",
  );
  const agents = new Map(
    keys.map((key) => [
      key,
      { key, hostKey: "host", roomKey: "room", semanticStatus: statuses[key] },
    ]),
  );
  const agentSeats = new Map(
    keys.map((key, i) => [key, { deskKey: deskKeys[i]!, seat: 0 }]),
  );
  const model = {
    agents,
    agentSeats,
    deskPins: new Map(),
  } as unknown as TownModel;
  return { layout, model, asking, agents: [...agents.values()] };
}

test("under every filter each agent has exactly one place, and filtered agents sit at their desks", () => {
  for (const subset of SUBSETS) {
    const { layout, model, asking, agents } = town();
    const takes = new Set(subset);
    const held = townReceptionHeld(agents, asking, () => takes);
    const actors = new TownActors();
    // Start from the default, then filter, as a running Town would.
    actors.sync(townActorWorld(layout, model), true, new Set(), asking);
    actors.sync(
      townActorWorld(layout, model),
      true,
      new Set(),
      asking,
      undefined,
      new Set(),
      held,
    );
    const slots = new Set<number>();
    for (const agent of agents) {
      const actor = actors.actors.get(agent.key);
      // Nobody vanishes: every agent is drawn somewhere in its building.
      expect(actor, `${subset} ${agent.key}`).toBeDefined();
      const mark = townReceptionMark(
        agent.semanticStatus,
        asking.has(agent.key),
      );
      const goal = actor!.goal!;
      if (mark && takes.has(mark)) {
        expect(goal.kind, `${subset} ${agent.key}`).toBe("queue");
        expect(held.has(agent.key)).toBe(false);
      } else if (mark) {
        // Filtered: seated at its own desk, never the lounge or the door.
        expect(held.has(agent.key)).toBe(true);
        expect(goal).toEqual({
          kind: "seat",
          deskKey: model.agentSeats.get(agent.key)!.deskKey,
          seat: 0,
        });
        expect(actor!.mode).toBe("seat");
      } else expect(goal.kind).not.toBe("queue");
      if (goal.kind === "queue") {
        expect(slots.has(goal.slot)).toBe(false);
        slots.add(goal.slot);
      }
    }
    expect(actors.actors.size).toBe(agents.length);
  }
});

test("reception's board takes only its marks and counts the rest at their desks", () => {
  const projection = projectWorldOffice(
    fixtureWorld([
      fixtureHost("alpha", [
        {
          label: "Demo",
          tabs: [
            {
              label: "Team",
              panes: [
                ["blocked"],
                ["done"],
                ["done"],
                ["idle"],
                ["working"],
                ["idle", false],
              ],
            },
          ],
        },
      ]),
    ]),
    0,
  );
  const agents = projection.roster.map(({ agent }) => agent);
  const hostKey = agents[0]!.hostKey;
  const asker = agents.find((agent) => agent.semanticStatus === "idle")!;
  const terminal = projection.paneRoster.find(
    ({ device }) => !device.agentKey,
  )!.device;
  const asking = new Set([asker.key, terminal.nodeId]);
  for (const subset of SUBSETS) {
    const takes = new Set(subset);
    const held = townReceptionHeld(agents, asking, () => takes);
    const board = townReceptionBoard(
      hostKey,
      agents,
      [terminal],
      asking,
      held,
      takes,
    );
    const at = (entry: (typeof board.visitors)[number]) =>
      "semanticStatus" in entry
        ? townReceptionMark(entry.semanticStatus, asking.has(entry.key))
        : "ask";
    // Every visitor is one reception takes; every other marked agent is kept.
    for (const visitor of board.visitors)
      expect(takes.has(at(visitor)!)).toBe(true);
    expect(board.visitors.length + board.kept.length).toBe(
      4 + (takes.has("ask") ? 1 : 0),
    );
    const total = [...board.keptCounts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(board.kept.length + (takes.has("ask") ? 0 : 1));
    if (!takes.has("done")) expect(board.keptCounts.get("done")).toBe(2);
  }
  // The default board is today's: blocked, the question, then finishes.
  const all = townReceptionBoard(
    hostKey,
    agents,
    [terminal],
    asking,
    new Set(),
    new Set(TOWN_RECEPTION_MARKS),
  );
  expect(all.kept).toEqual([]);
  expect(
    all.visitors.map((v) => ("semanticStatus" in v ? v.key : "t")),
  ).toEqual([
    agents.find((a) => a.semanticStatus === "blocked")!.key,
    asker.key,
    "t",
    ...agents.filter((a) => a.semanticStatus === "done").map((a) => a.key),
  ]);
});
