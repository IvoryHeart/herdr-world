import { StorageWriteRejected } from "../storage/world-protocol";
import type { WorldCliDeps } from "./world-cli";
import type { BoardDocument, BoardOp } from "./board-store";
import type { CliActor, LedgerChange } from "./world-ledger";

/** Admission guards the new edit; recording or compensation completes that edit. */
export function createBoardChange(
  completion: WorldCliDeps,
  patch: (deps: WorldCliDeps, ops: BoardOp[], actor: CliActor) => BoardDocument,
) {
  return async (
    request: WorldCliDeps,
    actor: CliActor,
    ops: BoardOp[],
    revert: BoardOp[],
    write: (document: BoardDocument) => LedgerChange | Promise<LedgerChange>,
  ) => {
    const document = patch(request, ops, actor);
    try {
      return await write(document);
    } catch (error) {
      if (!(error instanceof StorageWriteRejected)) throw error;
      try {
        // Only restore our exact edit. A later browser edit belongs to its owner.
        if (completion.board.get().revision === document.revision)
          patch(completion, revert, actor);
      } catch {
        // Keep the original storage failure; an uncertain write is never undone.
      }
      throw error;
    }
  };
}
