import { resolve } from "node:path";
import { sanitizeConnectionError } from "../connections/manager";
import type { ConnectionProfileService } from "../connections/profile-service";
import { ProfileInputError } from "../connections/profile-validation";
import { handleWorldCliEndpoint } from "./world-cli-endpoint";
import type { WorldSnapshotResult } from "../world/snapshot";

export const CONNECTIONS_CLI_PATH = "/api/connections/cli";

/** Local administration shares the agent endpoint's loopback/token admission. */
export function handleConnectionsCliEndpoint(
  req: Request,
  peer: { address: string; port: number } | null,
  deps: {
    serverPort: number;
    bearerAuth(req: Request, ip: string): true | Response | null;
    registryPath: string;
    snapshot?(): Promise<WorldSnapshotResult>;
    profiles: Pick<
      ConnectionProfileService,
      | "create"
      | "remove"
      | "setDefault"
      | "list"
      | "coreList"
      | "hosts"
      | "defaultId"
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
        if (request?.command === "host-add") {
          result = {
            host: await deps.profiles.hosts.add(params.host),
            snapshot: await deps.snapshot?.(),
          };
        } else if (request?.command === "host-remove") {
          result = await deps.profiles.hosts.remove(params.host_id);
        } else if (request?.command === "discover") {
          result = {
            host: await deps.profiles.hosts.connect(params.host_id),
            snapshot: await deps.snapshot?.(),
          };
        } else if (request?.command === "list") {
          result = {
            default_connection_id: deps.profiles.defaultId(),
            hosts: deps.profiles.hosts.list(),
            connections: deps.profiles.list(),
            core_connections: deps.profiles.coreList(),
            profiles: [
              ...deps.profiles.list(),
              ...deps.profiles.coreList(),
            ].map((profile) => ({
              ...profile,
              default: profile.id === deps.profiles.defaultId(),
              saved: !profile.read_only,
            })),
          };
        } else if (request?.command === "add") {
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
