import type { Database } from "bun:sqlite";
import type { BindingInput, SourceBinding } from "../world/binding-types";
import {
  planLegacyBindings,
  type LegacyBindingRow,
} from "./legacy-binding-plan";
import type { createWorldIds } from "./world-ids";

/** Compatibility keys locate JSON records; they are never new World IDs. */
export type LegacyBindingCapture = {
  key: string;
  input: Omit<BindingInput, "record_id"> & { record_id?: string };
  ended?: boolean;
};
export type LegacyBindingOperation =
  | { type: "begin" }
  | { type: "prepare"; captures: LegacyBindingCapture[] }
  | { type: "plan" }
  | { type: "put"; keys: string[] }
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
  let incoming: Map<string, LegacyBindingCapture> | null = null;
  let plan: Map<string, LegacyBindingRow> | null = null;
  const applied = new Set<string>();
  return (operation: LegacyBindingOperation) => {
    if (operation.type === "begin") {
      db.exec(
        "UPDATE world_binding_sync SET active=1; UPDATE world_binding_legacy SET present=0",
      );
      incoming = new Map();
      plan = null;
      applied.clear();
      return;
    }
    if (!incoming) throw new Error("Legacy binding capture was not begun");
    if (operation.type === "prepare") {
      if (plan) throw new Error("Legacy binding capture is already planned");
      const staged = structuredClone(operation.captures);
      const keys = new Set<string>();
      for (const capture of staged) {
        if (
          typeof capture.key !== "string" ||
          !capture.key ||
          capture.key.length > 4096 ||
          (capture.ended !== undefined && typeof capture.ended !== "boolean") ||
          keys.has(capture.key) ||
          incoming.has(capture.key)
        )
          throw new Error("invalid legacy binding capture");
        validate({
          ...capture.input,
          record_id: capture.input.record_id ?? "validation-only",
        });
        keys.add(capture.key);
      }
      for (const capture of staged)
        db.query("UPDATE world_binding_legacy SET present=1 WHERE key=?").run(
          capture.key,
        );
      for (const capture of staged) incoming.set(capture.key, capture);
      return;
    }
    if (operation.type === "plan") {
      if (plan) throw new Error("Legacy binding capture is already planned");
      plan = planLegacyBindings(read(), [...incoming.values()]);
      return;
    }
    if (!plan) throw new Error("Legacy binding capture is not planned");
    if (operation.type === "finish") {
      if (applied.size !== incoming.size)
        throw new Error("Legacy binding capture is incomplete");
      db.exec(
        "DELETE FROM world_bindings WHERE id IN (SELECT binding_id FROM world_binding_legacy WHERE present=0); UPDATE world_binding_sync SET active=0",
      );
      incoming = null;
      plan = null;
      applied.clear();
      return;
    }
    if (
      new Set(operation.keys).size !== operation.keys.length ||
      operation.keys.some((key) => !incoming!.has(key) || applied.has(key))
    )
      throw new Error("invalid legacy binding application page");
    for (const key of operation.keys) {
      const capture = incoming.get(key)!;
      const saved = plan.get(key);
      if (saved) {
        const current = db
          .query(
            "SELECT json_extract(body,'$.revision') AS revision FROM world_bindings WHERE id=?",
          )
          .get(saved.binding.id) as { revision: number } | null;
        if (!current || current.revision !== saved.binding.revision)
          throw new Error("Legacy binding changed after planning");
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
      }
    }
    for (const key of operation.keys) applied.add(key);
  };
}
