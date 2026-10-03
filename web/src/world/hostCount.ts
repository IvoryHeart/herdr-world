import type { ConnectionSummary } from "../api";

/** Count known runtime endpoints once; unidentified connections remain distinct. */
export function hostCount(connections: readonly ConnectionSummary[]): number {
  const endpoints = connections.map((connection) => {
    if (
      connection.type === "local" &&
      connection.control_socket_path &&
      connection.client_socket_path
    ) {
      return JSON.stringify([
        "local",
        connection.control_socket_path,
        connection.client_socket_path,
      ]);
    }
    if (
      connection.type === "ssh" &&
      connection.ssh_destination &&
      connection.remote_control_socket_path &&
      connection.remote_client_socket_path
    ) {
      return JSON.stringify([
        "ssh",
        connection.ssh_destination,
        connection.remote_control_socket_path,
        connection.remote_client_socket_path,
      ]);
    }
    return JSON.stringify(["connection", connection.id]);
  });
  return new Set(endpoints).size;
}
