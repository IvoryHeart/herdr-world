import { planBoardPatch } from "./board-plan";
import { parseAppearanceTarget } from "../../../shared/appearance";
import type { GroupSender } from "../../../shared/groups";
import { isGroupOp } from "./board-groups";
import { StorageWriteRejected } from "../storage/world-protocol";
import type { WorldCliDeps } from "./world-cli";
import type { BoardDocument, BoardPatch } from "./board-store";
import type { CliActor, LedgerChange } from "./world-ledger";

/** Admission guards the new edit; recording or compensation completes that edit. */
export function createBoardChange(
  completion: WorldCliDeps,
  patch: (
    deps: WorldCliDeps,
    ops: BoardPatch,
    actor: CliActor,
  ) => BoardDocument | Promise<BoardDocument>,
  patchIf: (
    deps: WorldCliDeps,
    revision: number,
    ops: BoardPatch,
    actor: CliActor,
  ) => BoardDocument | null | Promise<BoardDocument | null>,
) {
  return async (
    request: WorldCliDeps,
    actor: CliActor,
    ops: BoardPatch,
    revert: () => BoardPatch,
    write: (document: BoardDocument) => LedgerChange | Promise<LedgerChange>,
  ) => {
    const document = await patch(request, ops, actor);
    try {
      return await write(document);
    } catch (error) {
      if (!(error instanceof StorageWriteRejected)) throw error;
      try {
        // Only restore our exact edit. A later browser edit belongs to its owner.
        await patchIf(completion, document.revision, revert(), actor);
      } catch {
        // Keep the original storage failure; an uncertain write is never undone.
      }
      throw error;
    }
  };
}

export const authoredOps = (input: BoardPatch, actor: CliActor) =>
  planBoardPatch([input, actor], (current: BoardDocument) => {
    const ops = typeof input === "function" ? input(current) : input;
    if (ops === null) return null;
    const sender: GroupSender = {
      label: actor.label,
      basis: actor.verified ? "inferred" : "reported",
      via: "cli",
    };
    const bindings = Object.values(current.appearance ?? {});
    return ops.map((op) => {
      if (op.op === "card.color") {
        const binding = bindings.find((record) => record.color_key === op.key);
        if (binding)
          return {
            op: "appearance.set" as const,
            target: parseAppearanceTarget(binding),
            fields: { color: op.color },
          };
      }
      return isGroupOp(op) ? { ...op, sender } : op;
    });
  });
