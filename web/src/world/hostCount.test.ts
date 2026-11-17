import { expect, test } from "bun:test";
import type { ConnectionSummary } from "../api";
import { hostCount } from "./hostCount";

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
