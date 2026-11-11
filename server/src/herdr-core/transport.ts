import { rmSync } from "node:fs";
import { sshReadCommandArgv } from "../bridge/ssh-command";
import {
  createSshTunnelManager,
  type SshTunnelConfig,
  type SshTunnelError,
} from "../bridge/ssh-tunnel";
import type { CoreConnectionProfile } from "../connections/profiles";
import { createSshProfileRuntimeConfig } from "../connections/ssh-profile-runtime";
import {
  runProcess,
  runProcessWithCodeTimeout,
  shQuote,
} from "../utils/process-utils";
import {
  defaultCoreStateDir,
  remoteCoreEndpointCommand,
  remoteCoreEndpointResult,
  resolveLocalCoreEndpoint,
} from "./endpoint";
import type { CoreTransport } from "./runtime";
import { windowsSshCoreTransport } from "./windows";

/** A local core: the lock is read again on every connect. */
export function localCoreTransport(stateDir: string): CoreTransport {
  return {
    open: async (signal) => {
      signal.throwIfAborted();
      return resolveLocalCoreEndpoint(stateDir);
    },
    close: async () => {},
  };
}

export type SshCoreTransportDependencies = {
  readRemote?: (argv: string[]) => Promise<{ code: number; stdout: string }>;
  createConfig?: (profile: CoreConnectionProfile) => SshTunnelConfig;
  createTunnel?: typeof createSshTunnelManager;
};

/**
 * A Unix SSH core: a plain remote `cat` of the lock on every connect, then a
 * stream-local forward to exactly that socket. A changed path is a new
 * forward, because each connect builds its own.
 */
export function sshCoreTransport(
  profile: CoreConnectionProfile,
  options: {
    connectionId: string;
    onTunnelExit?: (error: SshTunnelError) => void;
  },
  dependencies: SshCoreTransportDependencies = {},
): CoreTransport {
  const destination = profile.ssh_destination;
  if (profile.type !== "ssh" || profile.remote_platform || !destination)
    throw new Error("a Unix SSH core connection needs an SSH destination");
  const config = (
    dependencies.createConfig ??
    ((value: CoreConnectionProfile) =>
      createSshProfileRuntimeConfig({
        id: value.id,
        label: value.label,
        type: "ssh",
        ssh_destination: destination,
        remote_control_socket_path: "",
        remote_client_socket_path: "",
        auto_connect: value.auto_connect,
      }))
  )(profile);
  const readRemote =
    dependencies.readRemote ??
    ((argv: string[]) => runProcessWithCodeTimeout(argv, 20_000));
  let tunnel: ReturnType<typeof createSshTunnelManager> | null = null;
  return {
    open: async (signal) => {
      const command = `sh -c ${shQuote(
        remoteCoreEndpointCommand(profile.core_session, profile.core_state_dir),
      )}`;
      const result = await readRemote(
        sshReadCommandArgv(destination, command, [], "core.lock"),
      );
      signal.throwIfAborted();
      const remoteSocket = remoteCoreEndpointResult(result.code, result.stdout);
      tunnel = (dependencies.createTunnel ?? createSshTunnelManager)({
        connectionId: options.connectionId,
        config: {
          ...config,
          remoteSocketPath: remoteSocket,
          hasExplicitSocketPath: true,
          remoteClientSocketPath: undefined,
          hasExplicitClientSocketPath: true,
        },
        runProcess,
        onUnexpectedExit: options.onTunnelExit,
      });
      await tunnel.startAutoSshTunnel();
      signal.throwIfAborted();
      return config.socketPath;
    },
    close: async () => {
      if (tunnel) await tunnel.cleanupAutoSshTunnel();
      else if (config.ownedRuntimeDirectory)
        rmSync(config.ownedRuntimeDirectory, { recursive: true, force: true });
    },
  };
}

export function coreTransportForProfile(
  profile: CoreConnectionProfile,
  options: {
    connectionId: string;
    onTunnelExit?: (error: SshTunnelError) => void;
  },
): CoreTransport {
  if (profile.type === "ssh" && profile.remote_platform === "windows")
    return windowsSshCoreTransport(profile);
  if (profile.type === "ssh") return sshCoreTransport(profile, options);
  return localCoreTransport(
    profile.core_state_dir || defaultCoreStateDir(profile.core_session),
  );
}
