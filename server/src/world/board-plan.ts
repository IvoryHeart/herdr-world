import type { BoardDocument, BoardOp, BoardPlanner } from "./board-types";

/** Declare every retained payload; nested planners carry their reservation through guards. */
export function planBoardPatch(
  retained: readonly unknown[],
  prepare: (document: BoardDocument) => readonly BoardOp[] | null,
): BoardPlanner {
  const retainedBytes = retained.reduce<number>((total, value) => {
    const bytes =
      typeof value === "function"
        ? (value as BoardPlanner).retainedBytes
        : Buffer.byteLength(JSON.stringify(value) ?? "");
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Invalid Board planning reservation");
    return total + bytes;
  }, 0);
  return Object.assign(prepare, { retainedBytes });
}
