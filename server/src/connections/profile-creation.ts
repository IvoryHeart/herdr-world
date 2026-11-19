import type {
  ConnectionProfileBootstrap,
  ManagedConnectionProfile,
  StartupLocalProfile,
} from "./profile-service";
import type { ServerConfig } from "../config/server-config";
import { isCoreProfile, type LocalConnectionProfile } from "./profiles";
import {
  type ConnectionIdentity,
  STARTUP_DEFAULT_CONNECTION_ID,
} from "./types";

export function connectionIdentityForProfile(
  profile: ManagedConnectionProfile,
): ConnectionIdentity {
  return {
    id: profile.id,
    label: profile.label,
    source:
      profile.id === STARTUP_DEFAULT_CONNECTION_ID
        ? "startup-config"
        : profile.type === "ssh"
          ? "ssh-profile"
          : "local-profile",
  };
}

export function startupConnectionSettings(config: ServerConfig) {
  return {
    startupDefaultProfile: {
      id: STARTUP_DEFAULT_CONNECTION_ID,
      label: "Default",
      type: "local" as const,
      control_socket_path: config.socketPath,
      client_socket_path: config.clientSocketPath,
      auto_connect: true,
    } satisfies StartupLocalProfile,
    explicitStartupOverride: Boolean(
      config.hasExplicitSocketPath ||
        config.hasExplicitClientSocketPath ||
        config.sshHost ||
        config.session,
    ),
  };
}

/** Preserve the implicit local server when first saving a connection catalogue. */
export function localMigrationSeed(
  bootstrap: ConnectionProfileBootstrap,
  newProfileId: string,
): LocalConnectionProfile | null {
  const startupProfile = bootstrap.registrations.find(
    (registration) => registration.profile.id === STARTUP_DEFAULT_CONNECTION_ID,
  )?.profile;
  if (
    !startupProfile ||
    startupProfile.type !== "local" ||
    isCoreProfile(startupProfile)
  )
    return null;
  return {
    id: newProfileId === "local" ? "localhost" : "local",
    label: "Local",
    type: "local",
    control_socket_path: startupProfile.control_socket_path,
    client_socket_path: startupProfile.client_socket_path,
    auto_connect: true,
  };
}
