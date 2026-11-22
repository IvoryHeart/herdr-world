import type { BridgeRpcContext } from "./context";
import type { BoardElementAction } from "../world/board-element-service";

export async function handleBoardElementsRpc(
  rpc: BridgeRpcContext,
): Promise<void> {
  try {
    const service = rpc.services.boardElements;
    if (!service) throw new Error("Board elements are unavailable");
    const action = rpc.method.slice(
      "world.board.elements.".length,
    ) as BoardElementAction;
    rpc.sendReply(
      {
        id: rpc.id,
        result: await service.call(
          action,
          rpc.params ?? {},
          rpc.requestIsCurrent,
        ),
      },
      rpc.method,
    );
  } catch (error) {
    rpc.sendError("world-board-elements-error", error);
  }
}
