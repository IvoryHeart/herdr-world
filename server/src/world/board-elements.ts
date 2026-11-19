import {
  BOARD_ELEMENT_LIMITS,
  parseBoardElement,
} from "../../../shared/boardElements";
import type { BoardDocument, BoardOp } from "./board-types";

export function checkBoardElements(document: BoardDocument) {
  const elements = document.elements ?? [];
  if (elements.length > BOARD_ELEMENT_LIMITS.count)
    throw new Error("too many Board elements");
  const ids = elements.map((entry) => entry.id);
  const existing = new Set(
    [...document.notes, ...document.strings, ...document.relations.groups].map(
      (entry) => entry.id,
    ),
  );
  if (new Set(ids).size !== ids.length || ids.some((id) => existing.has(id)))
    throw new Error("duplicate Board record IDs");
}

export function applyBoardElementOp(
  next: BoardDocument,
  op: BoardOp,
  conflict: (message: string) => never,
): boolean {
  if (op.op !== "element.put" && op.op !== "element.delete") return false;
  const elements = next.elements ?? [];
  const id = op.op === "element.put" ? op.element?.id : op.id;
  const existing = elements.find((entry) => entry.id === id);
  if (existing ? existing.rev !== op.rev : op.rev !== undefined)
    conflict("That Board element changed or was removed. Read it again.");
  if (op.op === "element.delete") {
    if (!existing) conflict("That Board element was removed.");
    next.elements = elements.filter((entry) => entry.id !== id);
    if (!next.elements.length) delete next.elements;
  } else {
    // One committed Board revision also fences batched edits and later ID reuse.
    const parsed = parseBoardElement(op.element, next.revision + 1);
    next.elements = existing
      ? elements.map((entry) => (entry.id === id ? parsed : entry))
      : [...elements, parsed];
  }
  return true;
}
