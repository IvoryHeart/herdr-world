import { HerdrClient } from "../bridge/herdr-client";
import {
  assertSupportedHerdrProtocol,
  HerdrCompatibilityError,
} from "../bridge/protocol-compat";
import { createSshTunnelManager } from "../bridge/ssh-tunnel";
import { ThinClient } from "../bridge/thin-client";
import { runProcess } from "../utils/process-utils";
import { createSshProfileRuntimeConfig } from "./ssh-profile-runtime";
import type { LocalConnectionProfile } from "./profiles";
import type { StartupLocalProfile, TuiManagedProfile } from "./profile-service";

export class ConnectionProbeError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConnectionProbeError";
  }
}

/** Native local transport failures only; arbitrary error text is not retry intent. */
export function retryableLocalSocketError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    /^(?:ENOENT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE)$/.test(code ?? "") ||
    /^(?:ENOENT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE):/.test(
      error.message,
    ) ||
    /^(?:timeout: ping|connection closed before response: ping|timed out waiting for Herdr protocol \d+ handshake|thin client connection closed during handshake)$/.test(
      error.message,
    )
  );
}

export async function testConnectionSockets(
  controlSocketPath: string,
  clientSocketPath: string,
): Promise<{ ok: true; version: string | null; protocol: number }> {
  const herdr = new HerdrClient(controlSocketPath);
  let thinClient: ThinClient | null = null;
  try {
    const ping = await herdr.call("ping", {}, 8_000);
    const protocol: unknown = ping?.protocol;
    try {
      assertSupportedHerdrProtocol(protocol);
    } catch (error) {
      throw new ConnectionProbeError((error as Error).message, false, {
        cause: error,
      });
    }
    thinClient = new ThinClient(clientSocketPath, async () => protocol);
    // ThinClient mirrors runtime failures through EventEmitter in addition to
    // rejecting connect(). A probe has no long-lived consumer, but it still
    // must register an error listener before opening the socket so ordinary
    // render failures remain contained by this promise.
    thinClient.on("error", () => undefined);
    try {
      await thinClient.connect(80, 24);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent =
        error instanceof HerdrCompatibilityError ||
        /(?:protocol .*not supported|rejected thin-client protocol|welcomed protocol|unsupported encoding|bincode:|invalid protocol version)/i.test(
          message,
        );
      throw new ConnectionProbeError(
        message,
        !permanent && retryableLocalSocketError(error),
        { cause: error },
      );
    }
    return {
      ok: true,
      version: typeof ping?.version === "string" ? ping.version : null,
      protocol,
    };
  } finally {
    thinClient?.close();
  }
}

export function testLocalConnectionProfile(
  profile: LocalConnectionProfile | StartupLocalProfile,
) {
  return testConnectionSockets(
    profile.control_socket_path,
    profile.client_socket_path,
  );
}

export async function testConnectionProfile(profile: TuiManagedProfile) {
  if (profile.type === "local") return testLocalConnectionProfile(profile);
  const config = createSshProfileRuntimeConfig(profile);
  const tunnel = createSshTunnelManager({ config, runProcess });
  try {
    await tunnel.startAutoSshTunnel();
    return await testConnectionSockets(
      config.socketPath,
      config.clientSocketPath,
    );
  } finally {
    await tunnel.cleanupAutoSshTunnel();
  }
}
