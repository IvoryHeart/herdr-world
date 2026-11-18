import { resolve } from "node:path";
import { sanitizeConnectionError } from "./manager";
import type { ConnectionProfileService } from "./profile-service";
import type { ConnectionProfile } from "./profiles";
import type { WorldCliResponse } from "../world/world-cli-protocol";

export type ConnectionCliChange =
  | { action: "add"; profile: ConnectionProfile; make_default: boolean }
  | { action: "remove" | "set-default"; id: string };

export type ConnectionCliAdmission = {
  service: Pick<ConnectionProfileService, "create" | "remove" | "setDefault">;
  path: string;
};

/** Called only behind the loopback, non-browser CLI bearer admission. */
export async function handleConnectionCli(
  body: unknown,
  admission: ConnectionCliAdmission,
): Promise<WorldCliResponse | null> {
  const request = body as {
    command?: unknown;
    params?: Record<string, unknown>;
  } | null;
  if (
    typeof request?.command !== "string" ||
    !request.command.startsWith("connections.")
  )
    return null;
  try {
    const params = request.params;
    if (
      !params ||
      typeof params.registry_path !== "string" ||
      resolve(params.registry_path) !== resolve(admission.path)
    )
      throw new Error(
        "the running service owns a different connection registry; check the service configuration",
      );
    let result: unknown;
    if (request.command === "connections.add") {
      if (typeof params.make_default !== "boolean")
        throw new Error("make_default must be a boolean");
      result = await admission.service.create(params.profile, {
        makeDefault: params.make_default,
      });
    } else if (request.command === "connections.remove") {
      result = await admission.service.remove(params.id);
    } else if (request.command === "connections.set-default") {
      result = await admission.service.setDefault(params.id);
    } else throw new Error("unknown connections command");
    return { ok: true, actor: { label: "Local CLI", verified: false }, result };
  } catch (error) {
    return {
      ok: false,
      code: "unavailable",
      error: sanitizeConnectionError(error),
    };
  }
}
