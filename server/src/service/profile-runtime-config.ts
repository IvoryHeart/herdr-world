import type { SshTunnelConfig } from "../bridge/ssh-tunnel";
import type { StartupLocalProfile } from "../connections/profile-service";
import type { TuiConnectionProfile } from "../connections/profiles";
import { createSshProfileRuntimeConfig } from "../connections/ssh-profile-runtime";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";

type StartupConfig = Pick<
  SshTunnelConfig,
  | "socketPath"
  | "clientSocketPath"
  | "sshHost"
  | "session"
  | "hasExplicitSocketPath"
  | "hasExplicitClientSocketPath"
>;

/**
 * The downstream config a connection profile's runtime uses: the service's
 * own startup config for the startup default, an SSH runtime for SSH
 * profiles, and the profile's explicit sockets for local ones.
 */
export function profileRuntimeConfig(
  profile: TuiConnectionProfile | StartupLocalProfile,
  config: StartupConfig,
): SshTunnelConfig {
  if (profile.id === STARTUP_DEFAULT_CONNECTION_ID)
    return {
      socketPath: config.socketPath,
      clientSocketPath: config.clientSocketPath,
      sshHost: config.sshHost,
      session: config.session,
      hasExplicitSocketPath: config.hasExplicitSocketPath,
      hasExplicitClientSocketPath: config.hasExplicitClientSocketPath,
    };
  if (profile.type === "ssh") return createSshProfileRuntimeConfig(profile);
  return {
    socketPath: profile.control_socket_path,
    clientSocketPath: profile.client_socket_path,
    sshHost: undefined,
    session: undefined,
    hasExplicitSocketPath: true,
    hasExplicitClientSocketPath: true,
    ownedRuntimeDirectory: undefined,
  };
}
