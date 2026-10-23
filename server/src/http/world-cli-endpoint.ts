import { isLoopbackAddress } from "../workspace/file-manager";
import { callerProcesses, type CallerLocator } from "../world/caller-identity";
import type { CliErrorCode, WorldCliResponse } from "../world/world-cli";
import { readJsonBody } from "./json-body";

/**
 * POST /api/world/cli: the `herdr-world` agent CLI's way into the running
 * service. Loopback only, never from a browser (no Origin), and
 * authenticated with the CLI token derived from the session secret
 * (`worldCliToken`). When a call names a pane, the caller's process is found
 * from its TCP connection among that pane's processes, so the claim can be
 * checked.
 */

export const WORLD_CLI_PATH = "/api/world/cli";
/** Longer than the longest held `ask get` (world-cli.ts ASK_WAIT_MAX_MS). */
export const WORLD_CLI_IDLE_TIMEOUT_SECONDS = 40;
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
      locate: CallerLocator | null,
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
  if (auth !== true) {
    // Answer in the CLI's own shape, keeping the throttle's status and wait.
    const status = auth?.status ?? 401;
    const retry = auth?.headers.get("retry-after");
    return Response.json(
      {
        ok: false,
        code: "refused",
        error: !auth
          ? "missing World CLI token"
          : status === 429
            ? "too many wrong tokens; wait and try again"
            : "wrong World CLI token",
      },
      { status, headers: retry ? { "retry-after": retry } : {} },
    );
  }
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES);
  } catch {
    return Response.json(
      { ok: false, code: "usage", error: "the request must be JSON" },
      { status: 400 },
    );
  }
  // Searched only when the call names a pane, under that pane's processes.
  const locate: CallerLocator | null =
    (deps.platform ?? process.platform) === "linux" && peer
      ? (roots) =>
          (deps.callerChain ?? callerProcesses)(
            peer,
            deps.serverPort,
            undefined,
            roots,
          )
      : null;
  const response = await deps.handle(body, locate);
  return Response.json(response, {
    status: response.ok ? 200 : STATUS[response.code],
    headers: { "cache-control": "no-store" },
  });
}
