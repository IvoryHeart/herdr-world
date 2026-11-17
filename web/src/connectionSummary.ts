import {
  validateRemoteSocketPath,
  validateSshDestination,
  validateWindowsSshOptions,
} from "./sshProfileValidation";

/** A connection in World's catalog, as the bridge publishes it. */
export type ConnectionLifecycleState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "stopping"
  | "error";

export interface ConnectionSummary {
  id: string;
  label: string;
  source: string;
  is_default: boolean;
  state: ConnectionLifecycleState;
  generation: number;
  error?: { message: string };
  /** Present in profile-aware catalogs; optional during legacy bridge.status transition. */
  type?: "local" | "ssh";
  read_only?: boolean;
  auto_connect?: boolean;
  control_socket_path?: string;
  client_socket_path?: string;
  ssh_destination?: string;
  remote_control_socket_path?: string;
  remote_client_socket_path?: string;
  remote_platform?: "windows";
  remote_herdr_path?: string;
  remote_session?: string;
}

const CONNECTION_LIFECYCLE_STATES = new Set<ConnectionLifecycleState>([
  "disconnected",
  "connecting",
  "ready",
  "reconnecting",
  "stopping",
  "error",
]);

/** Parse the public catalog boundary without trusting arbitrary WebSocket JSON. */
export function parseConnectionSummary(
  value: unknown,
): ConnectionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    typeof item.label !== "string" ||
    typeof item.source !== "string" ||
    typeof item.is_default !== "boolean" ||
    typeof item.state !== "string" ||
    !CONNECTION_LIFECYCLE_STATES.has(item.state as ConnectionLifecycleState) ||
    typeof item.generation !== "number" ||
    !Number.isSafeInteger(item.generation) ||
    item.generation < 0
  ) {
    return null;
  }
  if (item.type !== undefined && item.type !== "local" && item.type !== "ssh") {
    return null;
  }
  if (item.type === "local") {
    if (
      typeof item.read_only !== "boolean" ||
      typeof item.auto_connect !== "boolean" ||
      typeof item.control_socket_path !== "string" ||
      !item.control_socket_path ||
      typeof item.client_socket_path !== "string" ||
      !item.client_socket_path ||
      item.ssh_destination !== undefined ||
      item.remote_control_socket_path !== undefined ||
      item.remote_client_socket_path !== undefined ||
      item.remote_platform !== undefined ||
      item.remote_herdr_path !== undefined ||
      item.remote_session !== undefined
    ) {
      return null;
    }
  }
  if (item.type === "ssh") {
    if (
      typeof item.read_only !== "boolean" ||
      typeof item.auto_connect !== "boolean" ||
      item.control_socket_path !== undefined ||
      item.client_socket_path !== undefined
    ) {
      return null;
    }
    try {
      validateWindowsSshOptions(item);
      const destination = validateSshDestination(item.ssh_destination);
      const controlPath = validateRemoteSocketPath(
        item.remote_control_socket_path,
        "Remote control socket",
      );
      const clientPath = validateRemoteSocketPath(
        item.remote_client_socket_path,
        "Remote render socket",
      );
      if (
        (controlPath && clientPath && controlPath === clientPath) ||
        !destination
      )
        return null;
    } catch {
      return null;
    }
  }
  const error =
    item.error &&
    typeof item.error === "object" &&
    !Array.isArray(item.error) &&
    typeof (item.error as { message?: unknown }).message === "string"
      ? { message: (item.error as { message: string }).message }
      : undefined;
  return {
    id: item.id,
    label: item.label,
    source: item.source,
    is_default: item.is_default,
    state: item.state as ConnectionLifecycleState,
    generation: item.generation,
    ...(error ? { error } : {}),
    ...(item.type === "local" || item.type === "ssh"
      ? { type: item.type }
      : {}),
    ...(typeof item.read_only === "boolean"
      ? { read_only: item.read_only }
      : {}),
    ...(typeof item.auto_connect === "boolean"
      ? { auto_connect: item.auto_connect }
      : {}),
    ...(typeof item.control_socket_path === "string"
      ? { control_socket_path: item.control_socket_path }
      : {}),
    ...(typeof item.client_socket_path === "string"
      ? { client_socket_path: item.client_socket_path }
      : {}),
    ...(typeof item.ssh_destination === "string"
      ? { ssh_destination: item.ssh_destination }
      : {}),
    ...(typeof item.remote_control_socket_path === "string"
      ? { remote_control_socket_path: item.remote_control_socket_path }
      : {}),
    ...(typeof item.remote_client_socket_path === "string"
      ? { remote_client_socket_path: item.remote_client_socket_path }
      : {}),
    ...(item.remote_platform === "windows"
      ? { remote_platform: "windows" as const }
      : {}),
    ...(typeof item.remote_herdr_path === "string"
      ? { remote_herdr_path: item.remote_herdr_path }
      : {}),
    ...(typeof item.remote_session === "string"
      ? { remote_session: item.remote_session }
      : {}),
  };
}
