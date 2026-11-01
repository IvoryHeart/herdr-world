import {
  appearanceFor,
  appearanceKey,
  continuingAppearance,
  parseAppearanceTarget,
  type AppearanceDocument,
  type AppearanceFields,
  type AppearanceTarget,
} from "../../../shared/appearance";
import type { BoardDocument, BoardOp } from "./board-store";

type Field = keyof AppearanceFields;
type Revisions = Partial<Record<Field, number>>;
export type AppearanceEdits = Map<
  string,
  { target: AppearanceTarget; fields: Revisions; color?: string | null }
>;
export type AppearanceChanges = (
  target: AppearanceTarget,
) => Partial<Record<Field, { revision: number; value: string | null }>>;
const fieldsOf = (target: AppearanceTarget): Field[] =>
  target.kind === "tab" ? ["color", "status"] : ["avatar"];

/** In-flight field intent, including resets, bounded by the current saved bindings. */
export function trackAppearanceEdits(
  edits: AppearanceEdits,
  ops: readonly BoardOp[],
  next: BoardDocument,
) {
  for (const op of ops) {
    if (
      op.op === "appearance.set" ||
      (op.op === "appearance.restore" && op.record)
    ) {
      const target = parseAppearanceTarget(
        op.op === "appearance.set" ? op.target : op.record,
      );
      const key = appearanceKey(target),
        previous = edits.get(key);
      const fields =
        previous && continuingAppearance(previous.target, target)
          ? { ...previous.fields }
          : {};
      let color =
        previous && continuingAppearance(previous.target, target)
          ? previous.color
          : undefined;
      for (const field of fieldsOf(target)) {
        // Record restoration writes metadata; colour compensation is a separate op.
        if (
          op.op === "appearance.restore" &&
          field === "color" &&
          !ops.some(
            (other) =>
              other.op === "card.color" && other.key === target.color_key,
          )
        )
          continue;
        if (op.op === "appearance.restore" || op.fields[field] !== undefined) {
          fields[field] = next.revision;
          if (field === "color")
            color =
              op.op === "appearance.set"
                ? op.fields.color
                : (next.layout.colors[target.color_key!] ?? null);
        }
      }
      edits.set(key, { target, fields, color });
    } else if (op.op === "appearance.relocate") {
      const from = appearanceKey(op.from),
        to = appearanceKey(op.target);
      if (from === to) continue;
      const source = edits.get(from),
        destination = edits.get(to);
      const fields =
        source && continuingAppearance(source.target, op.from)
          ? { ...source.fields }
          : {};
      let color =
        source && continuingAppearance(source.target, op.from)
          ? source.color
          : undefined;
      if (destination && continuingAppearance(destination.target, op.target))
        for (const field of fieldsOf(op.target))
          if (
            (destination.fields[field] ?? -1) >= (fields[field] ?? -1) &&
            destination.fields[field] !== undefined
          ) {
            fields[field] = destination.fields[field];
            if (field === "color") color = destination.color;
          }
      edits.delete(from);
      edits.set(to, {
        target: parseAppearanceTarget(op.target),
        fields,
        color,
      });
    }
  }
  for (const [key, edit] of edits) {
    const record = next.appearance?.[key];
    if (!record || !continuingAppearance(edit.target, record))
      edits.delete(key);
    else edit.target = parseAppearanceTarget(record);
  }
}

/** Read effective metadata and explicit colour intent, distinguishing resets from no write. */
export function captureAppearanceChanges(
  edits: AppearanceEdits,
  revision: number,
  document: () => AppearanceDocument,
): AppearanceChanges {
  return (target) => {
    const current = document(),
      record = appearanceFor(current.appearance, target);
    const edit = edits.get(appearanceKey(target));
    if (!record || !edit || !continuingAppearance(edit.target, target))
      return {};
    const changed: ReturnType<AppearanceChanges> = {};
    for (const field of fieldsOf(target)) {
      const written = edit.fields[field];
      if (written !== undefined && written > revision)
        changed[field] = {
          revision: written,
          value:
            field === "color"
              ? edit.color === undefined
                ? (current.layout.colors?.[record.color_key!] ?? null)
                : edit.color
              : (record[field] ?? null),
        };
    }
    return changed;
  };
}
