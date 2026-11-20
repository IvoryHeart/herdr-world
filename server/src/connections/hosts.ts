import { createHash } from "node:crypto";
import { validateSshDestination } from "../bridge/ssh-command";
import type { ConnectionProfile } from "./profiles";
import { isCoreProfile } from "./profiles";
import { validateConnectionId } from "./protocol";

export type {
  HostTarget,
  HostDiscoveryRecord,
  HostProfile,
  HostRuntime,
  WorldHost,
} from "../../../shared/hosts";
import type {
  HostTarget,
  HostDiscoveryRecord,
  HostProfile,
} from "../../../shared/hosts";

export function hostId(target: HostTarget): string {
  return target.type === "local"
    ? "host-local"
    : `host-${createHash("sha256").update(validateSshDestination(target.ssh_destination)).digest("hex").slice(0, 24)}`;
}

export function runtimeKind(profile: ConnectionProfile): string {
  return isCoreProfile(profile) ? "herdr-core" : "herdr";
}

export function hostForProfile(profile: ConnectionProfile): HostProfile {
  return {
    id: hostId(profile),
    label:
      profile.type === "local"
        ? "This computer"
        : profile.ssh_destination!.slice(0, 80),
    type: profile.type,
    ...(profile.type === "ssh"
      ? { ssh_destination: profile.ssh_destination }
      : {}),
    ...(profile.type === "ssh" && profile.remote_platform
      ? { remote_platform: profile.remote_platform }
      : {}),
    auto_connect: profile.auto_connect,
  };
}

/** Pure migration: group ownership without renaming a single runtime resource. */
export function migrateHosts(
  profiles: readonly ConnectionProfile[],
  saved: readonly HostProfile[] = [],
): HostProfile[] {
  const hosts = new Map(saved.map((host) => [host.id, structuredClone(host)]));
  for (const profile of profiles) {
    const host = hostForProfile(profile);
    const existing = hosts.get(host.id);
    if (!existing) hosts.set(host.id, host);
    else if (!saved.some((entry) => entry.id === host.id)) {
      if (host.remote_platform) existing.remote_platform = host.remote_platform;
    }
  }
  // Existing per-runtime settings remain authoritative after migration. Empty
  // hosts have no profiles yet, so retain their saved onboarding policy.
  for (const host of hosts.values()) {
    const members = profiles.filter((profile) => hostId(profile) === host.id);
    if (members.length)
      host.auto_connect = members.some((profile) => profile.auto_connect);
  }
  return [...hosts.values()];
}

export function forgetHostRuntime(
  hosts: HostProfile[] | undefined,
  connectionId: string,
): HostProfile[] | undefined {
  return hosts?.map((host) => ({
    ...host,
    ...(host.discovered
      ? {
          discovered: host.discovered.filter(
            (runtime) => runtime.connection_id !== connectionId,
          ),
        }
      : {}),
  }));
}

export function validateHostProfile(value: unknown): HostProfile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("host must be an object");
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "id",
    "label",
    "type",
    "ssh_destination",
    "remote_platform",
    "auto_connect",
    "discovered",
    "preview_fixture",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new Error("unknown host field");
  if (input.type !== "local" && input.type !== "ssh")
    throw new Error("invalid host type");
  const target: HostTarget =
    input.type === "ssh"
      ? {
          type: "ssh",
          ssh_destination: validateSshDestination(input.ssh_destination),
        }
      : { type: "local" };
  if (
    input.type === "local" &&
    (input.ssh_destination !== undefined || input.remote_platform !== undefined)
  )
    throw new Error("local host cannot have SSH settings");
  if (
    input.remote_platform !== undefined &&
    input.remote_platform !== "windows"
  )
    throw new Error("invalid remote_platform");
  if (input.id !== hostId(target))
    throw new Error("host id must match its destination");
  if (
    typeof input.label !== "string" ||
    !input.label.trim() ||
    input.label.trim() !== input.label ||
    input.label.length > 80 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(input.label)
  )
    throw new Error("invalid host label");
  if (typeof input.auto_connect !== "boolean")
    throw new Error("auto_connect must be a boolean");
  if (
    input.preview_fixture !== undefined &&
    (input.preview_fixture !== "empty" ||
      target.ssh_destination !== "runtime-fixture.example" ||
      input.auto_connect !== false)
  )
    throw new Error(
      "preview fixture requires runtime-fixture.example with auto-connect disabled",
    );
  let discovered: HostDiscoveryRecord[] | undefined;
  if (input.discovered !== undefined) {
    if (!Array.isArray(input.discovered) || input.discovered.length > 64)
      throw new Error("invalid host discovery records");
    const ids = new Set<string>();
    discovered = input.discovered.map((record) => {
      if (
        !record ||
        typeof record !== "object" ||
        Object.keys(record).some(
          (key) =>
            !["connection_id", "kind", "version", "present"].includes(key),
        )
      )
        throw new Error("invalid host discovery record");
      const id = validateConnectionId(record.connection_id);
      if (
        record.kind !== undefined &&
        (typeof record.kind !== "string" ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(record.kind))
      )
        throw new Error("invalid runtime kind");
      if (
        ids.has(id) ||
        typeof record.present !== "boolean" ||
        !(
          record.version === null ||
          (typeof record.version === "string" &&
            record.version.length <= 80 &&
            !/[\u0000-\u001f\u007f-\u009f]/.test(record.version))
        )
      )
        throw new Error("invalid host discovery record");
      ids.add(id);
      return {
        connection_id: id,
        version: record.version,
        present: record.present,
        ...(record.kind ? { kind: record.kind } : {}),
      };
    });
  }
  return {
    ...target,
    id: input.id,
    label: input.label,
    auto_connect: input.auto_connect,
    ...(input.remote_platform ? { remote_platform: "windows" } : {}),
    ...(discovered ? { discovered } : {}),
    ...(input.preview_fixture ? { preview_fixture: "empty" } : {}),
  };
}
