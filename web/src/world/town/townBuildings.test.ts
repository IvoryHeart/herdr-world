import { describe, expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "../board/boardFixture";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { officeRoomActionCapabilities } from "../officeRoomActions";
import { officeReadModel } from "../officeReadModel";
import { createTownBuildings, townBuildingsMode } from "./townBuildings";
import { townModelFromProjection } from "./townModel";
import { layoutTown } from "./townLayout";

// The real shape: two runtimes on this computer and one remote host.
const office = projectWorldOffice(
  fixtureWorld([
    fixtureHost("tui", [
      { label: "Web", tabs: [{ label: "Build", panes: [["working"]] }] },
      { label: "Docs", tabs: [{ label: "Edit", panes: [["blocked"]] }] },
    ]),
    fixtureHost("core", [
      { label: "Core", tabs: [{ label: "Run", panes: [["blocked"]] }] },
    ]),
    fixtureHost("remote", [
      { label: "Api", tabs: [{ label: "Test", panes: [["idle"]] }] },
    ]),
  ]),
  0,
);
const groups = [
  {
    id: "host-local",
    label: "This computer",
    connectionIds: ["tui", "core"],
    runtimes: [
      { id: "tui", runtime: "herdr" as const },
      { id: "core", runtime: "herdr-core" as const },
    ],
  },
  {
    id: "host-remote",
    label: "dev.example.test",
    connectionIds: ["remote"],
    runtimes: [{ id: "remote", runtime: "herdr" as const }],
  },
];
const keyOf = (connectionId: string) =>
  office.hosts.find((host) => host.connectionId === connectionId)!.key;

test("the flag picks a building per runtime; anything else, per host", () => {
  expect(townBuildingsMode("")).toBe("host");
  expect(townBuildingsMode("?townBuildings=host")).toBe("host");
  expect(townBuildingsMode("?view=town&townBuildings=runtime")).toBe("runtime");
  // The Settings choice holds unless the page names a layout.
  expect(townBuildingsMode("", "runtime")).toBe("runtime");
  expect(townBuildingsMode("?townBuildings=other", "runtime")).toBe("runtime");
  expect(townBuildingsMode("?townBuildings=host", "runtime")).toBe("host");
});

test("a building per host holds every runtime's rooms", () => {
  const town = createTownBuildings()(office, groups, "host");
  expect(
    town.hosts.map(({ key, displayLabel, displayOrder }) => [
      key,
      displayLabel,
      displayOrder,
    ]),
  ).toEqual([
    [keyOf("tui"), "This computer", 0],
    [keyOf("remote"), "dev.example.test", 1],
  ]);
  const core = town.rooms.find(
    (room) => room.workspaceRef.connectionId === "core",
  )!;
  // The room stands in the host's building but still targets its runtime.
  expect(core.hostKey).toBe(keyOf("tui"));
  expect(core.desks[0]!.tabRef.connectionId).toBe("core");
  expect(core.desks.every((desk) => desk.hostKey === keyOf("tui"))).toBe(true);
  // The second runtime's rooms follow the first's.
  const local = town.rooms
    .filter((room) => room.hostKey === keyOf("tui"))
    .sort((a, b) => a.order - b.order)
    .map((room) => room.workspaceRef.connectionId);
  expect(local).toEqual(["tui", "tui", "core"]);
  // One reception per machine, queueing both runtimes' agents.
  expect(town.receptions.map((reception) => reception.hostKey)).toEqual([
    keyOf("tui"),
    keyOf("remote"),
  ]);
  expect(
    town.receptions[0]!.waitingAgents.map(
      (agent) => agent.currentPaneRef.connectionId,
    ),
  ).toEqual(["tui", "core"]);
  expect(
    town.roster.every((entry) => entry.agent.hostKey === entry.hostKey),
  ).toBe(true);
  // Room keys are unchanged, so saved spots, colours and pins still apply.
  expect(town.rooms.map((room) => room.key).sort()).toEqual(
    office.rooms.map((room) => room.key).sort(),
  );
  const { layout } = layoutTown(townModelFromProjection(town).input, "wide");
  expect(layout.buildings.map((building) => building.rooms.length)).toEqual([
    3, 1,
  ]);
  // Lookups answer with the building's copy of an agent.
  const agent = office.roster.find(
    (entry) => entry.agent.currentPaneRef.connectionId === "core",
  )!.agent;
  expect(officeReadModel(town).agentOf(agent.key)?.hostKey).toBe(keyOf("tui"));
});

test("a building per runtime stands beside its host's other runtimes", () => {
  const town = createTownBuildings()(office, groups, "runtime");
  expect(
    town.hosts.map(({ connectionId, displayLabel }) => [
      connectionId,
      displayLabel,
    ]),
  ).toEqual([
    ["tui", "This computer · Herdr"],
    ["core", "This computer · herdr-core"],
    ["remote", "dev.example.test"],
  ]);
  expect(
    town.rooms.every(
      (room) => room.hostKey === keyOf(room.workspaceRef.connectionId),
    ),
  ).toBe(true);
  expect(town.receptions).toHaveLength(3);
});

test("the same office keeps its buildings; unknown hosts stay as they are", () => {
  const buildings = createTownBuildings();
  const first = buildings(office, groups, "host");
  expect(buildings(office, groups, "host")).toBe(first);
  // Without host groups (no catalogue yet), each runtime keeps its building.
  expect(createTownBuildings()(office, [], "host")).toBe(office);
});

test("every room in a host building keeps its runtime's room controls", () => {
  // Three runtimes on one machine (#1189): rooms of the second and third
  // stand in the first's building and must still rename, close and move.
  const world = fixtureWorld([
    fixtureHost("tui", [{ label: "Web", tabs: [] }]),
    fixtureHost("core", [{ label: "Core", tabs: [] }]),
    fixtureHost("other", [{ label: "Other", tabs: [] }]),
  ]);
  const machine = [
    {
      id: "host-local",
      label: "This computer",
      connectionIds: ["tui", "core", "other"],
      runtimes: [
        { id: "tui", runtime: "herdr" as const },
        { id: "core", runtime: "herdr-core" as const },
        { id: "other", runtime: "herdr" as const },
      ],
    },
  ];
  const projected = projectWorldOffice(world, 0);
  const controls = (mode: "host" | "runtime") =>
    Object.fromEntries(
      createTownBuildings()(projected, machine, mode).rooms.map((room) => [
        room.key,
        officeRoomActionCapabilities(world, room),
      ]),
    );
  const byHost = controls("host");
  expect(byHost).toEqual(controls("runtime"));
  expect(Object.values(byHost)).toHaveLength(3);
  for (const capabilities of Object.values(byHost)) {
    expect(capabilities.rename).toBe(true);
    expect(capabilities.close).toBe(true);
  }
});

describe("two connections to one Herdr socket", () => {
  const socket = JSON.stringify(["local", "/tmp/herdr.sock", "/tmp/c.sock"]);
  const twice = (options: { localStale?: boolean } = {}) =>
    projectWorldOffice(
      fixtureWorld([
        fixtureHost("startup-default", [
          { label: "Web", tabs: [{ label: "Build", panes: [["blocked"]] }] },
        ]),
        fixtureHost(
          "local",
          [{ label: "Web", tabs: [{ label: "Build", panes: [["blocked"]] }] }],
          { stale: options.localStale },
        ),
        fixtureHost("core", [{ label: "Core", tabs: [] }]),
      ]),
      0,
    );
  const machine = [
    {
      id: "host-local",
      label: "This computer",
      connectionIds: ["startup-default", "local", "core"],
      runtimes: [
        {
          id: "startup-default",
          runtime: "herdr" as const,
          endpoint: socket,
          readOnly: true as const,
        },
        { id: "local", runtime: "herdr" as const, endpoint: socket },
        { id: "core", runtime: "herdr-core" as const, endpoint: "core" },
      ],
    },
  ];
  const connectionsOf = (town: ReturnType<typeof twice>) => ({
    rooms: town.rooms.map((room) => room.workspaceRef.connectionId),
    receptions: town.receptions.flatMap((reception) =>
      reception.waitingAgents.map((agent) => agent.currentPaneRef.connectionId),
    ),
    roster: town.roster.map((entry) => entry.agent.currentPaneRef.connectionId),
  });

  test("give one set of rooms, from the writable connection", () => {
    const town = createTownBuildings()(twice(), machine, "host");
    expect(town.hosts.map(({ displayLabel }) => displayLabel)).toEqual([
      "This computer",
    ]);
    expect(connectionsOf(town)).toEqual({
      rooms: ["local", "core"],
      receptions: ["local"],
      roster: ["local"],
    });
    const byRuntime = createTownBuildings()(twice(), machine, "runtime");
    expect(
      byRuntime.hosts.map(({ connectionId, displayLabel }) => [
        connectionId,
        displayLabel,
      ]),
    ).toEqual([
      ["local", "This computer · Herdr"],
      ["core", "This computer · herdr-core"],
    ]);
    expect(connectionsOf(byRuntime).rooms).toEqual(["local", "core"]);
  });

  test("show the live connection while the writable one is down", () => {
    const town = createTownBuildings()(
      twice({ localStale: true }),
      machine,
      "host",
    );
    expect(connectionsOf(town).rooms).toEqual(["startup-default", "core"]);
  });
});
