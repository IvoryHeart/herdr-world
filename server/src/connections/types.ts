export const STARTUP_DEFAULT_CONNECTION_ID = "startup-default";
// Kept for settings written by the upstream Roamgate runtime. New World
// state uses the explicit startup connection identity.
export const LEGACY_DEFAULT_CONNECTION_ID = "legacy-default";

export type ConnectionId = string;

export type ConnectionIdentity = {
  id: ConnectionId;
  label: string;
  source: string;
};

export type StartupConnectionIdentity = ConnectionIdentity & {
  id: typeof STARTUP_DEFAULT_CONNECTION_ID;
  label: "Default";
  source: "startup-config";
};

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "stopping"
  | "error";

export type ConnectionStatus = {
  id: ConnectionId;
  label: string;
  source: string;
  is_default: boolean;
  state: ConnectionState;
  generation: number;
  error?: {
    message: string;
  };
};

export const STARTUP_DEFAULT_CONNECTION: StartupConnectionIdentity = {
  id: STARTUP_DEFAULT_CONNECTION_ID,
  label: "Default",
  source: "startup-config",
};
