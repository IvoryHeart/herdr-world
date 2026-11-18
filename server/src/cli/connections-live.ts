import { readWorldCliToken, sessionSecretPath } from "../config/session-secret";
import type { ConnectionCliChange } from "../connections/cli-admission";
import type { CliContext } from "./command";
import {
  connectionRegistryPath,
  probeUrl,
  readServiceAccess,
  runtimeDataRoot,
  type ServiceSetup,
} from "./service-context";
import { isLoopbackAddress } from "../workspace/file-manager";

/** Target the configured service, ignoring agent-CLI URL/token overrides. */
export async function applyLiveConnectionChange(
  context: CliContext,
  setup: ServiceSetup,
  change: ConnectionCliChange,
  request: typeof fetch = fetch,
): Promise<void> {
  const url = new URL("/api/world/cli", probeUrl(readServiceAccess(setup)));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "localhost" && !isLoopbackAddress(host))
    throw new Error("live connection edits require a loopback service address");
  const token = readWorldCliToken(
    sessionSecretPath(runtimeDataRoot(context.runtime, setup.env)),
  );
  if (!token)
    throw new Error(
      "no World CLI token for the running service; check its data directory",
    );
  const { action, ...params } = change;
  const response = await request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      command: `connections.${action}`,
      params: {
        ...params,
        registry_path: connectionRegistryPath(context.runtime, setup.env),
      },
    }),
    redirect: "error",
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(60_000),
  });
  const reply = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || reply.ok !== true)
    throw new Error(
      reply.error ?? `live connection change failed (${response.status})`,
    );
}
