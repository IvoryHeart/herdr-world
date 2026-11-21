import { expect, test } from "bun:test";
import type { ConnectionSummary } from "../../api";
import type { CoreConnectionSummary } from "../../coreConnections";
import { fixtureHost, fixtureWorld } from "../board/boardFixture";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { officeSpaceForRoom } from "../officeRoomActions";
import { officeReadModel } from "../officeReadModel";
import {
  createTownBuildings,
  townBuildingOf,
  townBuildingsMode,
  type TownRuntime,
  townRuntimes,
} from "./townBuildings";
import { layoutTown } from "./townLayout";
import { townModelFromProjection } from "./townModel";

// The owner's shape: this computer's Herdr TUI seen through two connections
// of one socket (the startup default and a saved profile), its herdr-core,
// and a remote host that does not answer.
const world = fixtureWorld([
  fixtureHost("tui-default", [
    { label: "Web", tabs: [{ label: "Build", panes: [["working"]] }] },
    { label: "Docs", tabs: [{ label: "Edit", panes: [["blocked"]] }] },
  ]),
  fixtureHost("tui-profile", [
    { label: "Web", tabs: [{ label: "Build", panes: [["working"]] }] },
    { label: "Docs", tabs: [{ label: "Edit", panes: [["blocked"]] }] },
  ]),
  fixtureHost("core", [
    { label: "Core", tabs: [{ label: "Run", panes: [["blocked"]] }] },
  ]),
  fixtureHost(
    "remote",
    [{ label: "Api", tabs: [{ label: "Test", panes: [["idle"]] }] }],
    { stale: true },
  ),
]);
const office = projectWorldOffice(world, 0);
const runtime = (
  id: string,
  kind: TownRuntime["runtime"],
  machine: string,
  endpoint = id,
  writable = true,
): TownRuntime => ({ id, runtime: kind, machine, endpoint, writable });
const runtimes = [
  runtime("tui-default", "herdr", "local", "local-socket", false),
  runtime("tui-profile", "herdr", "local", "local-socket"),
  runtime("core", "herdr-core", "local"),
  runtime("remote", "herdr", "ssh:dev.example.test"),
];
const keyOf = (connectionId: string) =>
  office.hosts.find((host) => host.connectionId === connectionId)!.key;
const roomsOf = (town: typeof office, connectionId: string) =>
  town.rooms.filter((room) => room.workspaceRef.connectionId === connectionId);

test("the setting picks the buildings; the page flag compares the two", () => {
  expect(townBuildingsMode("")).toBe("host");
  expect(townBuildingsMode("", "runtime")).toBe("runtime");
  expect(townBuildingsMode("?view=town&townBuildings=runtime")).toBe("runtime");
  expect(townBuildingsMode("?townBuildings=machine", "runtime")).toBe("host");
  expect(townBuildingsMode("?townBuildings=other", "runtime")).toBe("runtime");
});

test("a machine's building holds each runtime's rooms; identity is untouched", () => {
  const town = createTownBuildings()(office, runtimes, "host");
  // One view of the shared socket: the writable profile, not the default.
  expect(roomsOf(town, "tui-default")).toEqual([]);
  expect(roomsOf(town, "tui-profile")).toHaveLength(2);
  expect(town.hosts.map((host) => host.connectionId)).toEqual([
    "tui-profile",
    "core",
    "remote",
  ]);
  // The core's rooms stand in the TUI's building, keeping their own host.
  const [core] = roomsOf(town, "core");
  expect(core!.hostKey).toBe(keyOf("core"));
  expect(core!.buildingKey).toBe(keyOf("tui-profile"));
  expect(townBuildingOf(core!)).toBe(keyOf("tui-profile"));
  expect(core!.desks[0]!.hostKey).toBe(keyOf("core"));
  expect(core!.desks[0]!.tabRef.connectionId).toBe("core");
  // Every room still finds its own space, so its actions reach its runtime.
  for (const room of town.rooms)
    expect(officeSpaceForRoom(world, room)?.connectionId).toBe(
      room.workspaceRef.connectionId,
    );
  // Each identity field, at every depth, equals the projection's: only
  // Town's display fields differ on a copy.
  const display = new Set(["buildingKey", "buildingOrder", "runtimeTag"]);
  const own = (item: unknown) =>
    JSON.stringify(item, (field, value) =>
      display.has(field) ? undefined : value,
    );
  for (const room of town.rooms)
    expect(own(room)).toBe(
      own(office.rooms.find((each) => each.key === room.key)),
    );
  // Tags tell the building's runtimes apart; the remote room has none.
  expect(town.rooms.map((room) => room.runtimeTag)).toEqual([
    "Herdr TUI",
    "Herdr TUI",
    "herdr-core",
    undefined,
  ]);
  // No room, desk or agent shows twice.
  const keys = town.roster.map((entry) => entry.agent.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(
    town.roster.some(
      (entry) => entry.agent.currentPaneRef.connectionId === "tui-default",
    ),
  ).toBe(false);
  // Lookups answer with the building's copy, and nothing for the hidden view.
  const coreAgent =
    core!.roomAgents[0] ??
    town.roster.find(
      (entry) => entry.agent.currentPaneRef.connectionId === "core",
    )!.agent;
  expect(officeReadModel(town).agentOf(coreAgent.key)?.buildingKey).toBe(
    keyOf("tui-profile"),
  );
  const hidden = office.roster.find(
    (entry) => entry.agent.currentPaneRef.connectionId === "tui-default",
  )!.agent;
  expect(officeReadModel(town).agentOf(hidden.key)).toBeUndefined();
  // Laid out: one building for this computer (three rooms), one remote.
  const { input } = townModelFromProjection(town);
  const { layout } = layoutTown(input, "wide");
  expect(
    layout.buildings.map((building) => [
      building.hostKey,
      building.rooms.length,
    ]),
  ).toEqual([
    [keyOf("tui-profile"), 3],
    [keyOf("remote"), 1],
  ]);
  // The core's room follows the TUI's rooms in the building.
  const local = input.rooms
    .filter((room) => room.hostKey === keyOf("tui-profile"))
    .sort((x, y) => x.order - y.order);
  expect(local[local.length - 1]!.key).toBe(core!.key);
});

test("one building per runtime keeps each apart, still showing a socket once", () => {
  const town = createTownBuildings()(office, runtimes, "runtime");
  expect(town.hosts.map((host) => host.connectionId)).toEqual([
    "tui-profile",
    "core",
    "remote",
  ]);
  expect(
    town.rooms.every((room) => !room.buildingKey && !room.runtimeTag),
  ).toBe(true);
  const { layout } = layoutTown(townModelFromProjection(town).input, "wide");
  expect(layout.buildings.map((building) => building.rooms.length)).toEqual([
    2, 1, 1,
  ]);
});

test("a live view of a socket wins over a writable one that is down", () => {
  const down = projectWorldOffice(
    fixtureWorld([
      fixtureHost(
        "tui-profile",
        [{ label: "Web", tabs: [{ label: "Build", panes: [["idle"]] }] }],
        { stale: true },
      ),
      fixtureHost("tui-default", [
        { label: "Web", tabs: [{ label: "Build", panes: [["idle"]] }] },
      ]),
    ]),
    0,
  );
  const town = createTownBuildings()(down, runtimes, "host");
  expect(town.rooms.map((room) => room.workspaceRef.connectionId)).toEqual([
    "tui-default",
  ]);
});

test("a machine of one runtime, or none known, is the projection itself", () => {
  const solo = [runtime("tui-profile", "herdr", "local")];
  const lone = projectWorldOffice(
    fixtureWorld([
      fixtureHost("tui-profile", [
        { label: "Web", tabs: [{ label: "Build", panes: [["idle"]] }] },
      ]),
    ]),
    0,
  );
  const buildings = createTownBuildings();
  expect(buildings(lone, solo, "host")).toBe(lone);
  expect(buildings(office, [], "host")).toBe(office);
  // The same inputs give the same office, so Town does not lay out again.
  const again = createTownBuildings();
  expect(again(office, runtimes, "host")).toBe(again(office, runtimes, "host"));
});

test("the store's connections name each runtime's machine and endpoint", () => {
  const tui = (id: string, read_only: boolean) =>
    ({
      id,
      label: id,
      type: "local",
      state: "ready",
      generation: 1,
      read_only,
      control_socket_path: "/run/example/herdr.sock",
      client_socket_path: "/run/example/herdr-client.sock",
    }) as unknown as ConnectionSummary;
  const core = {
    id: "core",
    label: "core",
    type: "local",
    state: "ready",
    generation: 1,
    core_session: "default",
    core_state_dir: "",
  } as unknown as CoreConnectionSummary;
  const remote = {
    ...tui("remote", false),
    type: "ssh",
    ssh_destination: "dev.example.test",
    remote_control_socket_path: "/run/example/herdr.sock",
    remote_client_socket_path: "/run/example/herdr-client.sock",
  } as unknown as ConnectionSummary;
  const state = {
    connections: [tui("tui-default", true), tui("tui-profile", false), remote],
    coreConnections: [core],
  };
  const found = townRuntimes(state);
  expect(
    found.map(({ id, runtime, machine, writable }) => [
      id,
      runtime,
      machine,
      writable,
    ]),
  ).toEqual([
    ["tui-default", "herdr", "local", false],
    ["tui-profile", "herdr", "local", true],
    ["remote", "herdr", "ssh:dev.example.test", true],
    ["core", "herdr-core", "local", true],
  ]);
  expect(found[0]!.endpoint).toBe(found[1]!.endpoint);
  expect(townRuntimes({ ...state })).toBe(found);
});
