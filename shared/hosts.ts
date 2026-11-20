export type HostTarget = {
  type: "local" | "ssh";
  ssh_destination?: string;
  remote_platform?: "windows";
};

/** Runtime identities survive disappearance and rediscovery. */
export type HostDiscoveryRecord = {
  connection_id: string;
  kind?: string;
  version: string | null;
  present: boolean;
};

export type HostProfile = HostTarget & {
  id: string;
  label: string;
  auto_connect: boolean;
  discovered?: HostDiscoveryRecord[];
  /** Explicit preview-only fixture; restricted to runtime-fixture.example. */
  preview_fixture?: "empty";
};

export type HostRuntime = {
  connection_id: string;
  kind: string;
  version: string | null;
  installed: boolean;
  state:
    | "disconnected"
    | "connecting"
    | "ready"
    | "reconnecting"
    | "stopping"
    | "error"
    | "absent";
  generation: number;
  error?: { message: string };
};

export type WorldHost = HostTarget & {
  preview_fixture?: "empty";
  host_id: string;
  label: string;
  auto_connect: boolean;
  /** Legacy Hosts filter ticks and resource preferences keep these exact IDs. */
  connection_ids: string[];
  state: "ready" | "degraded" | "unavailable" | "empty" | "disconnected";
  discovery: "pending" | "complete" | "error";
  discovery_error?: string;
  runtimes: HostRuntime[];
  /** Only an empty, successfully discovered host suggests installation. */
  installable_runtimes: { kind: string; label: string }[];
};
