import { readWorldCliToken, sessionSecretPath } from "../config/session-secret";
import { CONNECTIONS_CLI_PATH } from "../http/connections-cli";
import { isLoopbackAddress } from "../workspace/file-manager";
import type { CliContext } from "./command";
import {
  probeUrl,
  readServiceAccess,
  runtimeDataRoot,
  type ServiceSetup,
} from "./service-context";

/** Use the configured service and its own secret, never an agent URL override. */
export async function applyLiveConnectionChange(
  context: CliContext,
  setup: ServiceSetup,
  command: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  const base = new URL(probeUrl(readServiceAccess(setup)));
  if (
    !isLoopbackAddress(base.hostname.replace(/^\[|\]$/g, "")) &&
    base.hostname !== "localhost"
  )
    throw new Error(
      "live connection changes need the configured service on loopback",
    );
  const token = readWorldCliToken(
    sessionSecretPath(runtimeDataRoot(context.runtime, setup.env)),
  );
  if (!token)
    throw new Error("no local service token; the registry was not changed");
  const response = await fetch(new URL(CONNECTIONS_CLI_PATH, base), {
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
  const reply = await response.json();
  if (
    !reply ||
    typeof reply !== "object" ||
    typeof reply.ok !== "boolean" ||
    (reply.ok && !response.ok)
  )
    throw new Error(
      "the running service did not confirm the connection change",
    );
  return reply;
}
