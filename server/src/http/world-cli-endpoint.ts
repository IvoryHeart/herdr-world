import { isLoopbackAddress } from "../workspace/file-manager";
import { callerProcesses, type CallerProcess } from "../world/caller-identity";
import type { CliErrorCode, WorldCliResponse } from "../world/world-cli";
import { readJsonBody } from "./json-body";

/**
 * POST /api/world/cli: the `herdr-world` agent CLI's way into the running
 * service. Loopback only, never from a browser (no Origin), and
 * authenticated with the login credential as a bearer token. The caller's
 * process is found from its TCP connection so its pane claim can be checked.
 */

export const WORLD_CLI_PATH = "/api/world/cli";
const MAX_BODY_BYTES = 64 * 1024;

const STATUS: Record<CliErrorCode, number> = {
  usage: 400,
  refused: 403,
  not_found: 404,
  unavailable: 503,
};

export async function handleWorldCliEndpoint(
  req: Request,
  peer: { address: string; port: number } | null,
  deps: {
    serverPort: number;
    bearerAuth(req: Request, ip: string): true | Response | null;
    handle(
      body: unknown,
      chain: readonly CallerProcess[] | null,
    ): Promise<WorldCliResponse>;
    callerChain?: typeof callerProcesses;
    platform?: string;
  },
): Promise<Response> {
  const ip = peer?.address ?? "unknown";
  if (req.method !== "POST")
    return new Response("method not allowed", { status: 405 });
  if (!isLoopbackAddress(ip) || req.headers.get("origin") !== null)
    return Response.json(
      { ok: false, code: "refused", error: "local command-line clients only" },
      { status: 403 },
    );
  const auth = deps.bearerAuth(req, ip);
  if (auth !== true)
    return (
      auth ??
      Response.json(
        { ok: false, code: "refused", error: "missing bearer token" },
        { status: 401 },
      )
    );
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES);
  } catch {
    return Response.json(
      { ok: false, code: "usage", error: "the request must be JSON" },
      { status: 400 },
    );
  }
  const chain =
    (deps.platform ?? process.platform) === "linux" && peer
      ? (deps.callerChain ?? callerProcesses)(peer.port, deps.serverPort)
      : null;
  const response = await deps.handle(body, chain);
  return Response.json(response, {
    status: response.ok ? 200 : STATUS[response.code],
    headers: { "cache-control": "no-store" },
  });
}
