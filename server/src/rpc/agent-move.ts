import type { AgentAddress, AgentMoveRequest } from "../../../shared/agentMove";
import { connectionRecoveryFingerprint } from "../connections/profiles";
import { moveAgentAcross } from "../world/agent-move";
import { moveSide } from "../world/agent-move-sides";
import type { BridgeRpcContext } from "./context";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose an agent and a destination room.");
  return value as Record<string, unknown>;
};

/** A move's address as the browser sends it, checked before any read. */
function endpoint(value: unknown, source: boolean) {
  const v = object(value);
  const keys = source
    ? [
        "connection_id",
        "workspace_id",
        "tab_id",
        "pane_id",
        "terminal_id",
        "color_key",
      ]
    : ["connection_id", "workspace_id"];
  for (const key of keys)
    if (
      typeof v[key] !== "string" ||
      !v[key] ||
      (v[key] as string).length > 512 ||
      /[\r\n\0]/.test(v[key] as string)
    )
      throw new Error("Invalid move address.");
  if (!Number.isSafeInteger(v.generation) || Number(v.generation) < 0)
    throw new Error("Refresh the runtime before moving.");
  if (v.cwd !== undefined && (typeof v.cwd !== "string" || v.cwd.length > 4096))
    throw new Error("Invalid destination folder.");
  return v;
}

/** world.agent.move: an agent to a room on another runtime (world/agent-move.ts). */
export async function handleAgentMoveRpc(rpc: BridgeRpcContext): Promise<void> {
  try {
    const request: AgentMoveRequest = {
      source: endpoint(rpc.params?.source, true) as AgentAddress,
      destination: endpoint(
        rpc.params?.destination,
        false,
      ) as AgentMoveRequest["destination"],
      ...(rpc.params?.fresh === true ? { fresh: true } : {}),
    };
    const { services } = rpc;
    // Connections of one runtime endpoint (a startup default and a saved
    // profile of one Herdr socket or core) are one runtime.
    const profiles = services.connectionProfiles.profilesById();
    const endpointOf = (id: string) => {
      const profile = profiles.get(id);
      return profile ? connectionRecoveryFingerprint(profile) : `id:${id}`;
    };
    const aliases = (id: string) =>
      [...profiles.keys()].filter(
        (other) => endpointOf(other) === endpointOf(id),
      );
    const logger = services.logger.child("agent-move");
    const result = await moveAgentAcross(
      {
        side: (id, generation) =>
          moveSide(services, id, generation, undefined, aliases(id)),
        board: services.board,
        publishBoardChanged: services.publishBoardChanged,
        publishWorldInvalidation: services.publishWorldInvalidation,
        sameRuntime: (a, b) => endpointOf(a) === endpointOf(b),
        ...(services.moveSettle ? { settle: services.moveSettle } : {}),
        log: (step, fields) =>
          step === "outcome" &&
          ["refused", "uncertain", "error"].includes(String(fields.outcome))
            ? logger.warn(`move ${step}`, fields)
            : logger.info(`move ${step}`, fields),
      },
      request,
    );
    rpc.sendReply({ id: rpc.id, result }, rpc.method);
  } catch (error) {
    rpc.sendError("world-agent-move-error", error);
  }
}
