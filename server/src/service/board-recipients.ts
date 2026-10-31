import { planBoardPatch } from "../world/board-plan";
import type { ReadyConnectionRegistry } from "../connections/protocol";
import { resolveReadyConnection } from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import {
  type ObservedAgent,
  readPaneRecipient,
  recipientOps,
} from "../world/board-recipient";
import type { BoardOp, BoardStorePort } from "../world/board-store";

export function createBoardRecipientRecorder(
  connectionManager: () => ReadyConnectionRegistry<LegacyConnectionRuntime>,
  board: () => BoardStorePort,
  publishBoardChanged: (revision: number) => void,
) {
  /**
   * Record which agent each newly strung pane end is for: the agent the
   * browser showed, confirmed by reading the pane on its host's current
   * runtime (see recipientOps). Saving never waits for this; a string left
   * unbound makes Send ask the user which agent to send to.
   */
  return async function bindBoardRecipients(
    ops: readonly BoardOp[],
    observed: ReadonlyMap<string, ObservedAgent>,
  ) {
    const witnesses: (() => boolean)[] = [];
    const recorded = await recipientOps(
      board().get(),
      ops,
      observed,
      async (connectionId, paneId) => {
        const { runtime, isCurrent } = resolveReadyConnection(
          connectionManager(),
          connectionId,
        );
        witnesses.push(isCurrent);
        const read = await readPaneRecipient(
          (rpc, rpcParams) => runtime.herdr.call(rpc, rpcParams, 10_000),
          paneId,
        );
        return isCurrent() ? read : null;
      },
    );
    if (recorded.length) {
      let changed = false;
      const document = await board().patch(
        planBoardPatch([recorded], () => {
          changed = witnesses.every((current) => current());
          return changed ? recorded : null;
        }),
      );
      if (changed) publishBoardChanged(document.revision);
    }
  };
}
