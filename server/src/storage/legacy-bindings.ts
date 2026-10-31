import type { Database } from "bun:sqlite";
import type { BindingInput, SourceBinding } from "../world/binding-types";
import { bindingWitnessMatches } from "../world/binding-resolution";
import type { createWorldIds } from "./world-ids";

/** Compatibility keys locate JSON records; they are never new World IDs. */
export type LegacyBindingCapture = {
  key: string;
  input: Omit<BindingInput, "record_id"> & { record_id?: string };
  ended?: boolean;
  ambiguous?: boolean;
};
export type LegacyBindingOperation =
  | { type: "begin" }
  | { type: "mark"; keys: string[] }
  | { type: "put"; captures: LegacyBindingCapture[] }
  | { type: "finish" };
export const legacyBindingsSchema = `
CREATE TABLE world_binding_legacy (
 key TEXT PRIMARY KEY, binding_id TEXT NOT NULL UNIQUE REFERENCES world_bindings(id) ON DELETE CASCADE,
 present INTEGER NOT NULL DEFAULT 1 CHECK(present IN (0,1)), ended INTEGER NOT NULL DEFAULT 0 CHECK(ended IN (0,1))
);
CREATE TABLE world_binding_sync(singleton INTEGER PRIMARY KEY CHECK(singleton=1), active INTEGER NOT NULL CHECK(active IN (0,1)));
INSERT INTO world_binding_sync VALUES(1,0);
`;

/** A complete listing of World-owned JSON records, never a source topology listing. */
export function createLegacyBindingWriter(
  db: Database,
  ids: ReturnType<typeof createWorldIds>,
  create: (input: BindingInput) => SourceBinding,
  validate: (input: unknown) => void,
) {
  const read = () =>
    (
      db
        .query(
          "SELECT l.key,l.present,l.ended,b.body FROM world_binding_legacy l JOIN world_bindings b ON b.id=l.binding_id",
        )
        .all() as {
        key: string;
        present: number;
        ended: number;
        body: string;
      }[]
    ).map((row) => ({
      ...row,
      binding: JSON.parse(row.body) as SourceBinding,
    }));
  return (operation: LegacyBindingOperation) => {
    if (operation.type === "begin") {
      db.exec(
        "UPDATE world_binding_sync SET active=1; UPDATE world_binding_legacy SET present=0",
      );
      return;
    }
    if (operation.type === "mark") {
      for (const key of operation.keys)
        db.query("UPDATE world_binding_legacy SET present=1 WHERE key=?").run(
          key,
        );
      return;
    }
    if (operation.type === "finish") {
      db.exec(
        "DELETE FROM world_bindings WHERE id IN (SELECT binding_id FROM world_binding_legacy WHERE present=0); UPDATE world_binding_sync SET active=0",
      );
      return;
    }
    const rows = read();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    for (const capture of operation.captures) {
      if (
        typeof capture.key !== "string" ||
        !capture.key ||
        capture.key.length > 4096 ||
        (capture.ended !== undefined && typeof capture.ended !== "boolean")
      )
        throw new Error("invalid legacy binding capture");
      validate({
        ...capture.input,
        record_id: capture.input.record_id ?? "validation-only",
      });
      let saved = byKey.get(capture.key);
      if (
        !saved &&
        !capture.ambiguous &&
        ["appearance", "tab-colour"].includes(capture.input.policy)
      ) {
        // A renamed legacy key may follow its single witnessed appearance record.
        // Records still present in the JSON document are never merged or stolen.
        const candidates = rows.filter(
          (row) =>
            !row.present &&
            row.binding.state !== "ended" &&
            row.binding.policy === capture.input.policy &&
            row.binding.adapter === capture.input.adapter &&
            row.binding.instance === capture.input.instance &&
            row.binding.kind === capture.input.kind &&
            (!capture.input.record_id ||
              capture.input.record_id === row.binding.record_id) &&
            bindingWitnessMatches(row.binding.evidence, {
              native_id: capture.input.native_id,
              terminals: capture.input.evidence.terminals,
            }),
        );
        if (candidates.length === 1) saved = candidates[0];
      }
      let binding: SourceBinding;
      if (saved) {
        if (
          capture.input.slot !== saved.binding.slot ||
          capture.input.policy !== saved.binding.policy
        )
          throw new Error("legacy binding record kind or slot changed");
        if (
          capture.input.record_id &&
          capture.input.record_id !== saved.binding.record_id
        )
          throw new Error("legacy binding record identity changed");
        const same =
          saved.binding.policy === capture.input.policy &&
          saved.binding.adapter === capture.input.adapter &&
          saved.binding.instance === capture.input.instance &&
          saved.binding.kind === capture.input.kind &&
          saved.binding.native_id === capture.input.native_id &&
          saved.binding.evidence.session === capture.input.evidence.session &&
          JSON.stringify([...saved.binding.evidence.terminals].sort()) ===
            JSON.stringify([...capture.input.evidence.terminals].sort());
        const kept = same && !(saved.ended && !capture.ended);
        binding = {
          ...saved.binding,
          ...capture.input,
          record_id: saved.binding.record_id,
          state: capture.ended
            ? "ended"
            : kept
              ? saved.binding.state
              : "unresolved",
          checked_at: kept ? saved.binding.checked_at : null,
        };
        if (JSON.stringify(binding) !== JSON.stringify(saved.binding))
          binding.revision = saved.binding.revision + 1;
        db.query("UPDATE world_bindings SET body=? WHERE id=?").run(
          JSON.stringify(binding),
          binding.id,
        );
        db.query(
          "UPDATE world_binding_legacy SET key=?,present=1,ended=? WHERE binding_id=?",
        ).run(capture.key, capture.ended ? 1 : 0, binding.id);
        byKey.delete(saved.key);
        Object.assign(saved, {
          key: capture.key,
          present: 1,
          ended: capture.ended ? 1 : 0,
          binding,
        });
        byKey.set(capture.key, saved);
      } else {
        binding = create({
          ...capture.input,
          record_id: capture.input.record_id ?? ids.issue("n"),
        });
        if (capture.ended) {
          binding.state = "ended";
          db.query("UPDATE world_bindings SET body=? WHERE id=?").run(
            JSON.stringify(binding),
            binding.id,
          );
        }
        db.query(
          "INSERT INTO world_binding_legacy(key,binding_id,present,ended) VALUES(?,?,1,?)",
        ).run(capture.key, binding.id, capture.ended ? 1 : 0);
        const row = {
          key: capture.key,
          present: 1,
          ended: capture.ended ? 1 : 0,
          binding,
          body: JSON.stringify(binding),
        };
        rows.push(row);
        byKey.set(capture.key, row);
      }
    }
  };
}
