import { expect, test } from "bun:test";
import type { ConnectionSummary } from "./api";
import { deriveHostGrouping, groupingHosts } from "../../shared/hostGrouping";
import {
  hostGroupCount,
  hostGroupOf,
  hostGroupRows,
  hostsFilterByGroup,
  machineStatus,
  worldHosts,
  type CoreConnectionProfileSummary,
} from "./worldHosts";

function core(
  id: string,
  details: Partial<CoreConnectionProfileSummary> = {},
): CoreConnectionProfileSummary {
  return {
    id,
    label: id,
    type: "local",
    runtime: "herdr-core",
    state: "ready",
    generation: 3,
    core_session: "default",
    core_state_dir: "",
    auto_connect: true,
    read_only: false,
    ...details,
  };
}

function connection(
  id: string,
  details: Partial<ConnectionSummary> = {},
): ConnectionSummary {
  return {
    id,
    label: id,
    source: "local-profile",
    is_default: false,
    state: "ready",
    generation: 1,
    type: "local",
    control_socket_path: "/tmp/example-control.sock",
    client_socket_path: "/tmp/example-client.sock",
    ...details,
  };
}

test("herdr-core hosts join the one host list after Herdr's, with their runtime", () => {
  const hosts = worldHosts({
    connections: [connection("local")],
    coreConnections: [
      core("box-core", { label: "Box core", state: "reconnecting" }),
    ],
  });
  expect(
    hosts.map(({ id, label, runtime, state, generation }) => ({
      id,
      label,
      runtime,
      state,
      generation,
    })),
  ).toEqual([
    {
      id: "local",
      label: "local",
      runtime: "herdr",
      state: "ready",
      generation: 1,
    },
    {
      id: "box-core",
      label: "Box core",
      runtime: "herdr-core",
      state: "reconnecting",
      generation: 3,
    },
  ]);
});

test("a core ID the Herdr catalogue already lists stays the Herdr host", () => {
  const hosts = worldHosts({
    connections: [connection("same")],
    coreConnections: [core("same"), core("only-core")],
  });
  expect(hosts.map(({ id, runtime }) => `${id}:${runtime}`)).toEqual([
    "same:herdr",
    "only-core:herdr-core",
  ]);
});

test("unchanged catalogue slices return the same list (stable for React)", () => {
  const sources = {
    connections: [connection("local")],
    coreConnections: [core("box")],
  };
  expect(worldHosts(sources)).toBe(worldHosts({ ...sources }));
  expect(worldHosts(sources)).not.toBe(
    worldHosts({ ...sources, coreConnections: [core("box")] }),
  );
});

test("a machine's status names each state its runtimes are not ready in", () => {
  expect(machineStatus(["ready", "ready"])).toBe("ready");
  expect(machineStatus(["disconnected", "disconnected"])).toBe("disconnected");
  expect(machineStatus(["ready", "reconnecting", "disconnected"])).toBe(
    "1 of 3 reconnecting, 1 of 3 disconnected",
  );
});

/** The catalogue and the grouping World publishes for it. */
function published(setting: "machine" | "runtime") {
  const connections = [
    connection("local", { label: "Local" }),
    connection("remote", { type: "ssh", ssh_destination: "box.example.test" }),
    connection("old", { type: undefined }),
  ];
  const coreConnections = [
    core("local-core", { label: "Local core", state: "reconnecting" }),
    core("remote-core", { type: "ssh", ssh_destination: "box.example.test" }),
  ];
  return {
    hosts: worldHosts({ connections, coreConnections }),
    grouping: deriveHostGrouping(
      groupingHosts(connections, coreConnections),
      setting,
      () => false,
    ),
  };
}

test("the Hosts list shows World's published machines with their runtimes and state", () => {
  const { hosts, grouping } = published("machine");
  const rows = [
    {
      key: "local",
      label: "Local",
      ids: ["local", "local-core"],
      runtimes: ["Herdr TUI", "herdr-core"],
      status: "1 of 2 reconnecting",
    },
    // In World's order: by name, so "old" before "remote".
    {
      key: "connection:old",
      label: "old",
      ids: ["old"],
      runtimes: [],
      status: "ready",
    },
    {
      key: "ssh:box.example.test",
      label: "remote",
      ids: ["remote", "remote-core"],
      runtimes: ["Herdr TUI", "herdr-core"],
      status: "ready",
    },
  ];
  expect(hostGroupRows(hosts, grouping)).toEqual(rows);
  expect(hostGroupCount(["local", "local-core", "remote"], grouping)).toBe(2);
  // A host is a machine, whatever "Group runtimes" says: one per runtime
  // changes Town's buildings, never the Hosts list or its count.
  const byRuntime = published("runtime").grouping;
  expect(hostGroupRows(hosts, byRuntime)).toEqual(rows);
  expect(hostGroupCount(["local", "local-core"], byRuntime)).toBe(1);
  expect(byRuntime.groups.map(({ key, host }) => [key, host])).toEqual([
    ["runtime:local", "local"],
    ["runtime:local-core", "local"],
    ["runtime:old", "connection:old"],
    ["runtime:remote", "ssh:box.example.test"],
    ["runtime:remote-core", "ssh:box.example.test"],
  ]);
});

test("a runtime World has not grouped yet is a row of its own, and nothing is grouped before World answers", () => {
  const { hosts, grouping } = published("machine");
  const later = worldHosts({
    connections: [connection("new")],
  });
  expect(hostGroupRows(later, grouping).map(({ key }) => key)).toEqual([
    "runtime:new",
  ]);
  expect(hostGroupRows(hosts, undefined).map(({ ids }) => ids)).toEqual(
    hosts.map(({ id }) => [id]),
  );
  expect(hostGroupOf(undefined)("local")).toBeUndefined();
});

test("a selection saved per connection widens to its whole published group", () => {
  const { grouping } = published("machine");
  expect(hostsFilterByGroup(null, grouping)).toBeNull();
  expect(hostsFilterByGroup([], grouping)).toEqual([]);
  expect(hostsFilterByGroup(["local"], grouping)).toEqual([
    "local",
    "local-core",
  ]);
  expect(hostsFilterByGroup(["local-core"], grouping)).toEqual([
    "local-core",
    "local",
  ]);
  const whole = ["remote", "remote-core"];
  expect(hostsFilterByGroup(whole, grouping)).toBe(whole);
  // An ID no group lists (yet) is kept for pruning to decide.
  expect(hostsFilterByGroup(["gone", "local"], grouping)).toEqual([
    "gone",
    "local",
    "local-core",
  ]);
  // One per runtime still widens to the machine: hosts are machines.
  expect(hostsFilterByGroup(["local"], published("runtime").grouping)).toEqual([
    "local",
    "local-core",
  ]);
});

test("each connection's group comes from the publication, one lookup per publication", () => {
  const { grouping } = published("machine");
  const groupOf = hostGroupOf(grouping);
  expect(groupOf("local")).toEqual({ key: "local", label: "Local", order: 0 });
  // Its place in World's order: its group's, then its own.
  expect(groupOf("local-core")).toEqual({
    key: "local",
    label: "Local",
    order: 1,
  });
  expect(groupOf("unknown")).toBeUndefined();
  expect(hostGroupOf(grouping)).toBe(groupOf);
  const byRuntime = hostGroupOf(published("runtime").grouping);
  expect(byRuntime("local-core")).toEqual(groupOf("local-core"));
});
