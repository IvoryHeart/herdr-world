import { moveAgent } from "../agent/move/service";
import type { AgentAddress, AgentMoveRequest } from "../../../shared/agentMove";
import type { BridgeRpcContext } from "./context";
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose an agent and a destination room.");
  return value as Record<string, unknown>;
};
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
export async function handleAgentMoveRpc(rpc: BridgeRpcContext): Promise<void> {
  try {
    if (rpc.params?.preview_busy === true) {
      rpc.sendReply(
        {
          id: rpc.id,
          result: {
            status: "refused",
            message:
              "This agent has background work running. Let it finish before moving. (Preview test)",
          },
        },
        rpc.method,
      );
      return;
    }
    const request: AgentMoveRequest = {
      source: endpoint(rpc.params?.source, true) as AgentAddress,
      destination: endpoint(
        rpc.params?.destination,
        false,
      ) as AgentMoveRequest["destination"],
    };
    rpc.sendReply(
      {
        id: rpc.id,
        result: await moveAgent(rpc.services, request, rpc.requestIsCurrent),
      },
      rpc.method,
    );
  } catch (error) {
    rpc.sendError("world-agent-move-error", error);
  }
}
