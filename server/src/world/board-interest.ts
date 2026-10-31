import {
  STORED_INTERESTS,
  isInterestKey,
  type StoredInterest,
  type GroupInterest,
} from "../../../shared/interest";
import type { BoardDocument, BoardOp } from "./board-store";

function fail(message: string): never {
  throw new Error(`invalid board: ${message}`);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, what: string, max: number) {
  if (typeof value !== "string" || !value || value.length > max)
    fail(`${what} must be a string of at most ${max} characters`);
  return value as string;
}

export function interests(
  value: unknown,
  keyLimit: number,
): Record<string, StoredInterest> {
  if (value === undefined) return {};
  if (!isObject(value)) fail("interest must be an object");
  const out: Record<string, StoredInterest> = {};
  for (const [key, entry] of Object.entries(value)) {
    text(key, "interest key", keyLimit);
    if (!STORED_INTERESTS.includes(entry as StoredInterest)) fail("interest");
    out[key] = entry as StoredInterest;
  }
  return out;
}
export function groupInterests(
  value: unknown,
  keyLimit: number,
): Record<string, GroupInterest> {
  if (value === undefined) return {};
  if (!isObject(value)) fail("group_interest must be an object");
  const out: Record<string, GroupInterest> = Object.create(null);
  for (const [id, interest] of Object.entries(value)) {
    text(id, "group interest ID", keyLimit);
    if (interest !== "muted" && interest !== "focused") fail("group interest");
    out[id] = interest as GroupInterest;
  }
  return out;
}

export function applyBoardInterest(
  document: BoardDocument,
  op: Extract<BoardOp, { op: "interest.set" | "group.interest" }>,
  keyLimit: number,
) {
  switch (op.op) {
    case "interest.set": {
      const key = text(op.key, "interest key", keyLimit);
      if (!isInterestKey(key)) fail("interest key");
      if (op.interest === null) delete document.layout.interest[key];
      else if (STORED_INTERESTS.includes(op.interest))
        document.layout.interest[key] = op.interest;
      else fail("interest");
      return;
    }
    case "group.interest": {
      const id = text(op.id, "group interest ID", keyLimit);
      if (
        !document.relations.groups.some(
          (group) =>
            group.id === id && (group.kind === "team" || group.kind === "pod"),
        )
      )
        fail("group interest requires a stored Team or Pod");
      const intent = (document.layout.group_interest ??= {});
      if (op.interest === null) delete intent[id];
      else if (op.interest === "muted" || op.interest === "focused")
        Object.defineProperty(intent, id, {
          value: op.interest,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      else fail("group interest");
      return;
    }
  }
}

/** Dissolution/deletion is storage state; temporary unresolved members are not. */
export function pruneGroupInterest(document: BoardDocument) {
  if (!document.layout.group_interest) return;
  const ids = new Set(document.relations.groups.map((group) => group.id));
  for (const id of Object.keys(document.layout.group_interest))
    if (!ids.has(id)) delete document.layout.group_interest[id];
}
export function checkGroupInterest(document: BoardDocument) {
  for (const id of Object.keys(document.layout.group_interest ?? {}))
    if (
      !document.relations.groups.some(
        (group) =>
          group.id === id && (group.kind === "team" || group.kind === "pod"),
      )
    )
      fail("group interest must name a stored Team or Pod");
}
