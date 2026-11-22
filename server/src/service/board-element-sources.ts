import {
  createBoardElementService,
  BoardSourceRefusal,
  type BoardElementProject,
} from "../world/board-element-service";
import type { RpcServices } from "../rpc/context";
import type { BoardProjectSource } from "../../../shared/boardElements";
import { createBoardRecipientRecorder } from "./board-recipients";

export function composeBoardData(deps: {
  board: RpcServices["board"];
  publish: RpcServices["publishBoardChanged"];
  sources(): Pick<RpcServices, "connectionManager" | "coreControl">;
}) {
  return {
    boardElements: createBoardElementService({
      board: deps.board,
      publish: deps.publish,
      project: (source, generation) =>
        boardElementProject(deps.sources(), source, generation),
    }),
    bindBoardRecipients: createBoardRecipientRecorder(
      () => deps.sources().connectionManager,
      deps.board,
      deps.publish,
    ),
  };
}

/** Never consult a default host or cached aggregate topology for file authority. */
export function boardElementProject(
  services: Pick<RpcServices, "connectionManager" | "coreControl">,
  source: BoardProjectSource,
  generation: number,
): BoardElementProject {
  const id = source.connection_id;
  if (services.coreControl?.manager.has(id)) {
    const lease = services.coreControl.manager.readyRuntimeLease(id);
    if (!lease || !lease.isCurrent() || lease.generation !== generation)
      throw new BoardSourceRefusal(
        "The named herdr-core generation is unavailable.",
      );
    return {
      files: services.coreControl.hostRuntime(lease).files,
      isCurrent: () => lease.isCurrent(),
    };
  }
  if (!services.connectionManager.has(id))
    throw new BoardSourceRefusal("The named connection is unavailable.");
  const lease = services.connectionManager.readyRuntimeLease(id);
  if (!lease || !lease.isCurrent() || lease.generation !== generation)
    throw new BoardSourceRefusal("The named Herdr generation is unavailable.");
  return { files: lease.runtime.files, isCurrent: () => lease.isCurrent() };
}
