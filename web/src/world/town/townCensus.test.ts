import { expect, test } from "bun:test";
import { townCensus, townCensusItem } from "./townCensus";
import { profiles, town } from "./townCensus.fixture";

const shape = (items: readonly { id: string; count: number }[]) =>
  items.map(({ id, count }) => [id, count]);

test("the census counts buildings, rooms, tables and the population by what it is doing", async () => {
  const { office, summary } = await town();
  const census = townCensus(office, summary, new Set(), null);
  expect(shape(census.places)).toEqual([
    ["buildings", 2],
    ["rooms", 3],
    ["tables", 5],
  ]);
  expect(shape(census.population)).toEqual([
    ["agents", 4],
    ["working", 1],
    ["waiting", 1],
    ["done", 0],
    ["quiet", 2],
  ]);
  // The board's columns and the census agree: both read the Town summary.
  expect(summary.counts).toMatchObject({
    agents: 4,
    working: 1,
    needsYou: 1,
    quiet: 2,
  });
  // Only a waiting count above zero takes the attention colour.
  expect(
    census.population.filter((entry) => entry.attention).map((e) => e.id),
  ).toEqual(["waiting"]);
  expect(townCensusItem(census, "waiting")!.showing).toBe("1 waiting on you");
});

test("each count carries the Town keys of what it counts", async () => {
  const { office, summary } = await town();
  const census = townCensus(office, summary, new Set(), null);
  const keys = (id: string) => new Set(townCensusItem(census, id)!.keys);
  expect(keys("buildings")).toEqual(new Set(office.hosts.map((h) => h.key)));
  expect(keys("rooms")).toEqual(new Set(office.roomRoster.map((r) => r.key)));
  const blocked = office.roster.find(
    ({ agent }) => agent.semanticStatus === "blocked",
  )!.agent;
  expect(keys("waiting")).toEqual(new Set([blocked.key]));
  const quiet = office.roster
    .filter(({ agent }) => agent.semanticStatus === "idle")
    .map(({ agent }) => agent.key);
  expect(keys("quiet")).toEqual(new Set(quiet));
});

test("waiting also lights whoever asked an open question", async () => {
  const { office, summary } = await town();
  const busy = office.roster.find(
    ({ agent }) => agent.semanticStatus === "working",
  )!.agent;
  const census = townCensus(office, summary, new Set([busy.key]), null);
  expect(townCensusItem(census, "waiting")!.keys).toContain(busy.key);
});

test("skills: each harness, plain shells, and the skills of launched agents' profiles", async () => {
  const { office, summary } = await town();
  expect(shape(townCensus(office, summary, new Set(), null).skills)).toEqual([
    ["harness:claude", 2],
    ["harness:codex", 2],
    ["shells", 1],
  ]);
  const codexes = office.roster
    .map(({ agent }) => agent)
    .filter((agent) => agent.harness === "codex");
  const census = townCensus(
    office,
    summary,
    new Set(),
    profiles(
      codexes.map((agent) => ({
        connection_id: agent.currentTerminalRef.connectionId,
        terminal_id: agent.currentTerminalRef.nativeId,
      })),
    ),
  );
  expect(shape(census.skills)).toEqual([
    ["harness:claude", 2],
    ["harness:codex", 2],
    ["shells", 1],
    ["skill:code-review", 2],
    ["skill:testing", 2],
  ]);
  expect(new Set(townCensusItem(census, "skill:testing")!.keys)).toEqual(
    new Set(codexes.map((agent) => agent.key)),
  );
  expect(townCensusItem(census, "skill:testing")!.showing).toBe(
    "2 agents with testing",
  );
});
