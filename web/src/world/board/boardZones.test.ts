import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld, type FixtureSpace } from "./boardFixture";
import { groupBoardZones, projectBoard, zoneHostKeys } from "./boardModel";
import { emptyLayout, placeNew, positions } from "./boardPlacement";
import { hostGroupOf, type WorldHost } from "../../worldHosts";

const spaces = (count: number): FixtureSpace[] =>
  Array.from({ length: count }, (_, s) => ({
    label: `space ${s}`,
    tabs: [{ label: "tab", panes: [["idle"]] }],
  }));

const catalogue = (
  id: string,
  runtime: WorldHost["runtime"],
  machine: string,
): WorldHost => ({
  id,
  label: id,
  runtime,
  state: "ready",
  generation: 1,
  endpoint: `${runtime}:${id}`,
  machine,
});

// Herdr TUI and herdr-core on this computer, and one SSH machine between them.
const hosts = [
  catalogue("tui", "herdr", "local"),
  catalogue("remote", "herdr", "ssh:dev.example.test"),
  catalogue("core", "herdr-core", "local"),
];
const core = fixtureHost("core", spaces(2));
core.connection = { ...core.connection, runtime: "herdr-core" };
const world = fixtureWorld([
  fixtureHost("tui", spaces(2)),
  fixtureHost("remote", spaces(1)),
  core,
]);

test("one per machine: a machine's runtimes share one Board zone, each keeping its own identity", () => {
  const projected = projectBoard(world);
  const model = groupBoardZones(projected, hostGroupOf(hosts, "machine"));
  expect(
    model.zones.map((zone) => [
      zone.key,
      zone.label,
      zone.hosts.map((host) => host.key),
      [...zone.tags.values()],
    ]),
  ).toEqual([
    ["local", "tui", ["tui", "core"], ["Herdr TUI", "herdr-core"]],
    ["ssh:dev.example.test", "remote", ["remote"], []],
  ]);
  // A zone's runtimes are adjacent; each keeps its connection, generation,
  // cards and anchor key, so operations stay qualified by connection.
  expect(model.hosts.map((host) => host.key)).toEqual([
    "tui",
    "core",
    "remote",
  ]);
  expect(model.hostByKey.get("core")).toBe(projected.hostByKey.get("core")!);
  expect(model.hostByKey.get("core")?.connectionId).toBe("core");
  expect(model.workspaces).toBe(projected.workspaces);
  expect(zoneHostKeys(model, "core")).toEqual(["tui", "core"]);
  expect(zoneHostKeys(model, "remote")).toEqual(["remote"]);
});

test("one per runtime: every runtime is its own zone, as before", () => {
  const model = groupBoardZones(
    projectBoard(world),
    hostGroupOf(hosts, "runtime"),
  );
  expect(model.zones.map((zone) => zone.hosts.map((host) => host.key))).toEqual(
    [["tui"], ["remote"], ["core"]],
  );
  expect(zoneHostKeys(model, "core")).toEqual(["core"]);
});

test("saved anchors survive a grouping switch, and a runtime joining a placed machine goes beside it", () => {
  const byRuntime = groupBoardZones(
    projectBoard(
      fixtureWorld([
        fixtureHost("tui", spaces(2)),
        fixtureHost("remote", spaces(1)),
      ]),
    ),
    hostGroupOf(hosts, "runtime"),
  );
  const saved = placeNew(byRuntime, emptyLayout());
  // herdr-core starts later, with the setting at one per machine.
  const byMachine = groupBoardZones(
    projectBoard(world),
    hostGroupOf(hosts, "machine"),
  );
  const next = placeNew(byMachine, saved);
  for (const key of ["tui", "remote"])
    expect(next.anchors.get(key)).toEqual(saved.anchors.get(key)!);
  const tui = saved.anchors.get("tui")!;
  const coreAnchor = next.anchors.get("core")!;
  // Below this computer's TUI cards, not past the SSH machine's zone.
  expect(coreAnchor.x).toBe(tui.x);
  const at = positions(byMachine, next);
  const tuiBottom = Math.max(
    ...byMachine.hostByKey
      .get("tui")!
      .workspaceKeys.map((key) => at.get(key)!.y),
  );
  expect(coreAnchor.y).toBeGreaterThan(tuiBottom);
  expect(coreAnchor.x).toBeLessThan(next.anchors.get("remote")!.x);
});
