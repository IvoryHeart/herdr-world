import { resolve } from "node:path";
import { readRunningInstance } from "../config/instance-lock";
import { readWorldCliToken, sessionSecretPath } from "../config/session-secret";
import { CONNECTIONS_CLI_PATH } from "../http/connections-cli";
import { isLoopbackAddress } from "../workspace/file-manager";
import type { CliContext } from "./command";
import {
  probeUrl,
  readServiceAccess,
  runtimeDataRoot,
  type ServiceAccessInfo,
  type ServiceSetup,
} from "./service-context";

export interface ConnectionServiceTarget {
  root: string;
  access: Pick<ServiceAccessInfo, "host" | "port" | "tls">;
  /** A lock owner must never be treated as offline after a failed probe. */
  running: boolean;
  managed: boolean;
}

/** The registry's own lock selects the listener; agent URLs grant no authority. */
export function connectionServiceTarget(
  context: CliContext,
  setup: ServiceSetup,
): ConnectionServiceTarget {
  const root = runtimeDataRoot(context.runtime, setup.env);
  const installedRoot = runtimeDataRoot(
    { ...context.runtime, env: {} },
    setup.env,
  );
  const installed = readServiceAccess(setup);
  const holder = readRunningInstance(root);
  const sameRoot = resolve(root) === resolve(installedRoot);
  if (
    holder &&
    (!Number.isInteger(holder.port) || holder.port < 1 || holder.port > 65535)
  )
    throw new Error(
      "the World owning this data folder has not recorded a listening address yet; wait for it to start or stop it before editing offline",
    );
  const access = holder
    ? {
        // Older locks recorded only the port. Keep their configured scheme,
        // using loopback for a separate foreground instance.
        host: holder.host ?? (sameRoot ? installed.host : "127.0.0.1"),
        port: holder.port,
        tls: holder.tls ?? installed.tls,
      }
    : installed;
  return {
    root,
    access,
    running: holder !== null,
    managed:
      sameRoot &&
      access.host === installed.host &&
      access.port === installed.port &&
      access.tls === installed.tls,
  };
}

export function supportsLiveConnectionChanges(
  target: ConnectionServiceTarget,
): boolean {
  const base = new URL(probeUrl(target.access));
  return (
    isLoopbackAddress(base.hostname.replace(/^\[|\]$/g, "")) ||
    base.hostname === "localhost"
  );
}

/** Use the registry owner's address and secret, never agent URL/token overrides. */
export async function applyLiveConnectionChange(
  _context: CliContext,
  target: ConnectionServiceTarget,
  command: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  const base = new URL(probeUrl(target.access));
  if (!supportsLiveConnectionChanges(target))
    throw new Error(
      "live connection changes need the configured service on loopback",
    );
  const token = readWorldCliToken(sessionSecretPath(target.root));
  if (!token)
    throw new Error(
      `World at ${base.origin} has no local CLI token; check HERDR_WORLD_DATA_DIR and start that World once`,
    );
  let response: Response;
  try {
    response = await fetch(new URL(CONNECTIONS_CLI_PATH, base), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ command, params }),
      tls: { rejectUnauthorized: false },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
  } catch (error) {
    throw new Error(
      `could not reach World at ${base.origin}: ${(error as Error).message}; check that this World is running at its recorded address`,
      { cause: error },
    );
  }
  let reply: unknown;
  try {
    reply = await response.json();
  } catch {
    // Old listeners and HTTP intermediaries can return plain text or HTML.
  }
  const status = `World at ${base.origin} (HTTP ${response.status})`;
  const failure =
    reply && typeof reply === "object" && "ok" in reply && reply.ok === false
      ? (reply as { code?: unknown; error?: unknown })
      : undefined;
  if (!response.ok || failure) {
    const reason =
      typeof failure?.error === "string"
        ? failure.error
        : response.status === 401
          ? "authentication failed (wrong or missing World CLI token)"
          : response.status === 403
            ? "connection change refused"
            : response.status === 429
              ? "too many wrong tokens; wait and try again"
              : response.status >= 500
                ? "service unavailable"
                : "connection change was not accepted";
    return {
      ok: false,
      code:
        response.status === 400 && failure?.code === "usage"
          ? "usage"
          : "refused",
      error: `${status}: ${reason}; check HERDR_WORLD_DATA_DIR and the target World's connections before retrying`,
    };
  }
  if (
    !reply ||
    typeof reply !== "object" ||
    !("ok" in reply) ||
    reply.ok !== true
  )
    throw new Error(
      `${status}: ${reply === undefined ? "unreadable reply" : "the service did not confirm the connection change"}`,
    );
  return { ok: true };
}
