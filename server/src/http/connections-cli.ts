import { resolve } from "node:path";
import { sanitizeConnectionError } from "../connections/manager";
import type { ConnectionProfileService } from "../connections/profile-service";
import { ProfileInputError } from "../connections/profile-validation";
import { handleWorldCliEndpoint } from "./world-cli-endpoint";

export const CONNECTIONS_CLI_PATH = "/api/connections/cli";

/** Local administration shares the agent endpoint's loopback/token admission. */
export function handleConnectionsCliEndpoint(
  req: Request,
  peer: { address: string; port: number } | null,
  deps: {
    serverPort: number;
    bearerAuth(req: Request, ip: string): true | Response | null;
    registryPath: string;
    profiles: Pick<
      ConnectionProfileService,
      "create" | "remove" | "setDefault"
    >;
  },
): Promise<Response> {
  return handleWorldCliEndpoint(req, peer, {
    ...deps,
    handle: async (body) => {
      const request = body as {
        command?: unknown;
        params?: Record<string, unknown>;
      } | null;
      const params = request?.params;
      if (
        !params ||
        typeof params.registry_path !== "string" ||
        resolve(params.registry_path) !== resolve(deps.registryPath)
      )
        return {
          ok: false,
          code: "refused",
          error:
            "the running service owns a different connection registry; use its service configuration",
        };
      try {
        let result: unknown;
        if (request?.command === "add") {
          if (
            params.default !== undefined &&
            typeof params.default !== "boolean"
          )
            throw new ProfileInputError("default must be a boolean");
          result = await deps.profiles.create(params.profile, {
            makeDefault: params.default === true,
            keepLocalDefault: true,
          });
        } else if (request?.command === "remove") {
          result = await deps.profiles.remove(params.id);
        } else if (request?.command === "set-default") {
          result = await deps.profiles.setDefault(params.id);
        } else {
          throw new ProfileInputError("unknown connections command");
        }
        return {
          ok: true,
          actor: { label: "local connection CLI", verified: false },
          result,
        };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof ProfileInputError ? "usage" : "unavailable",
          error: sanitizeConnectionError(error),
        };
      }
    },
  });
}
