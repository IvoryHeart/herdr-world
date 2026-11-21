import { expect, test } from "bun:test";
import type { ConnectionSummary } from "./api";
import {
  hostCount as countHosts,
  worldHosts,
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
  // Town shows such a pair once, preferring the connection World can edit.
  const [automatic, saved] = worldHosts({
    connections: [
      connection("startup-default", { read_only: true }),
      connection("local", { read_only: false }),
    ],
  });
  expect(automatic!.readOnly).toBe(true);
  expect(saved!.readOnly).toBeUndefined();
  expect(automatic!.endpoint).toBe(saved!.endpoint);
});

test("distinct local endpoints and disconnected hosts remain counted", () => {
  expect(
    hostCount([
      connection("local"),
      connection("other", { client_socket_path: "/tmp/other-client.sock" }),
      connection("offline", { type: "ssh", state: "disconnected" }),
    ]),
  ).toBe(3);
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

test("unknown endpoints are distinct and an empty catalogue counts zero", () => {
  expect(
    hostCount([
      connection("first", { control_socket_path: undefined }),
      connection("second", { control_socket_path: undefined }),
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
  expect(countHosts(hosts)).toBe(2);
});

test("core profiles of one core count once; other cores and sessions count apart", () => {
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
  ).toBe(4);
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
