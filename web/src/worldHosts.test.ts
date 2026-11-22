import { expect, test } from "bun:test";
import type { ConnectionSummary } from "./api";
import {
  hostCount as countHosts,
  hostsFilterByMachine,
  machineStatus,
  worldHosts,
  worldMachines,
  type CoreConnectionProfileSummary,
} from "./worldHosts";

const hostCount = (connections: ConnectionSummary[]) =>
  countHosts(worldHosts({ connections }));

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

test("automatic and saved connections to the same local runtime count once", () => {
  const connections = [
    connection("startup-default", {
      source: "startup-config",
      is_default: true,
    }),
    connection("local"),
    connection("remote", { type: "ssh", ssh_destination: "example.test" }),
  ];
  expect(hostCount(connections)).toBe(2);
  expect(hostCount(connections.slice(0, 1))).toBe(1);
});

test("local endpoints are one machine; disconnected hosts remain counted", () => {
  expect(
    hostCount([
      connection("local"),
      connection("other", { client_socket_path: "/tmp/other-client.sock" }),
      connection("offline", { type: "ssh", state: "disconnected" }),
    ]),
  ).toBe(2);
});

test("matching SSH endpoints count once without conflating destinations", () => {
  const remote = {
    type: "ssh" as const,
    ssh_destination: "example.test",
    remote_control_socket_path: "/tmp/example-control.sock",
    remote_client_socket_path: "/tmp/example-client.sock",
  };
  expect(
    hostCount([
      connection("remote", remote),
      connection("alias", remote),
      connection("other", { ...remote, ssh_destination: "other.example.test" }),
    ]),
  ).toBe(2);
});

test("unknown machines are distinct and an empty catalogue counts zero", () => {
  expect(
    hostCount([
      connection("first", { type: undefined }),
      connection("second", { type: undefined }),
    ]),
  ).toBe(2);
  expect(hostCount([])).toBe(0);
});

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
  // Both run on this computer: one machine.
  expect(countHosts(hosts)).toBe(1);
});

test("a machine's cores count once; other destinations count apart", () => {
  const remote = { type: "ssh" as const, ssh_destination: "core.example.test" };
  expect(
    countHosts(
      worldHosts({
        connections: [],
        coreConnections: [
          core("a"),
          core("b"),
          core("c", { core_session: "other" }),
          core("d", remote),
          core("e", remote),
          core("f", { ...remote, ssh_destination: "two.example.test" }),
        ],
      }),
    ),
  ).toBe(3);
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

test("one machine per computer or SSH destination, holding each runtime", () => {
  const hosts = worldHosts({
    connections: [
      connection("local", { label: "Local" }),
      connection("remote", {
        type: "ssh",
        ssh_destination: "box.example.test",
      }),
      connection("old", { type: undefined }),
    ],
    coreConnections: [
      core("local-core", { label: "Local core", state: "reconnecting" }),
      core("remote-core", { type: "ssh", ssh_destination: "box.example.test" }),
    ],
  });
  expect(worldMachines(hosts)).toEqual([
    {
      machine: "local",
      label: "Local",
      ids: ["local", "local-core"],
      status: "1 of 2 reconnecting",
    },
    {
      machine: "ssh:box.example.test",
      label: "remote",
      ids: ["remote", "remote-core"],
      status: "ready",
    },
    { machine: "connection:old", label: "old", ids: ["old"], status: "ready" },
  ]);
  expect(worldMachines(hosts)).toBe(worldMachines(hosts));
});

test("a machine's status names each state its runtimes are not ready in", () => {
  expect(machineStatus(["ready", "ready"])).toBe("ready");
  expect(machineStatus(["disconnected", "disconnected"])).toBe("disconnected");
  expect(machineStatus(["ready", "reconnecting", "disconnected"])).toBe(
    "1 of 3 reconnecting, 1 of 3 disconnected",
  );
});

test("a selection saved per connection widens to its whole machine", () => {
  const hosts = worldHosts({
    connections: [
      connection("local"),
      connection("remote", {
        type: "ssh",
        ssh_destination: "box.example.test",
      }),
    ],
    coreConnections: [core("local-core")],
  });
  expect(hostsFilterByMachine(null, hosts)).toBeNull();
  expect(hostsFilterByMachine([], hosts)).toEqual([]);
  expect(hostsFilterByMachine(["local"], hosts)).toEqual([
    "local",
    "local-core",
  ]);
  expect(hostsFilterByMachine(["local-core"], hosts)).toEqual([
    "local-core",
    "local",
  ]);
  const whole = ["remote"];
  expect(hostsFilterByMachine(whole, hosts)).toBe(whole);
  // An ID the catalogue does not list (yet) is kept for pruning to decide.
  expect(hostsFilterByMachine(["gone", "local"], hosts)).toEqual([
    "gone",
    "local",
    "local-core",
  ]);
});
