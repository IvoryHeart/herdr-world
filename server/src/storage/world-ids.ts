import type { Database } from "bun:sqlite";
import { newWorldId } from "./world-identifiers";

export type WorldIds = {
  /** Resolves after a permanent reservation commits in this instance's store. */
  issue(kind: string): Promise<string>;
};

// Preserve legacy IDs, including historical references and answer occurrences.
// Triggers keep imports and domain writes in the same transaction as reservations.
const sources = [
  ["asks", ["id", "json_extract(body,'$.answer.occurrence')"]],
  ["results", ["id"]],
  ["ledger_changes", ["id"]],
  ["outbox", ["id", "operation_id", "record_id"]],
  ["replay_changes", ["operation_id", "record_id"]],
] as const;
const reference = (field: string, owner: string) =>
  field.replace(/\b(id|body|operation_id|record_id)\b/g, `${owner}.$1`);
// A parent UPSERT can override a trigger's OR IGNORE policy. The sole writer
// excludes existing reservations before inserting, including on answer updates.
const reserve = (expression: string, from = "") =>
  `INSERT OR IGNORE INTO world_ids(id) SELECT ${expression} ${from}
   WHERE ${expression} IS NOT NULL AND ${expression}<>''
   AND NOT EXISTS(SELECT 1 FROM world_ids WHERE id=${expression});`;
export const worldIdsMigration = `
CREATE TABLE world_ids(id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0));
${sources.map(([table, fields]) => fields.map((field) => reserve(reference(field, table), `FROM ${table}`)).join("\n")).join("\n")}
${sources
  .map(
    ([table, fields]) => `
CREATE TRIGGER ${table}_reserve_ids AFTER INSERT ON ${table} BEGIN
${fields.map((field) => reserve(reference(field, "NEW"))).join("\n")}
END;`,
  )
  .join("\n")}
CREATE TRIGGER asks_reserve_answer AFTER UPDATE OF body ON asks BEGIN
${reserve("json_extract(NEW.body,'$.answer.occurrence')")}
END;
`;

/** Worker-only: issue inside its operation savepoint and acknowledge after COMMIT. */
export function createWorldIds(db: Database, bytes?: () => Uint8Array) {
  const exists = db.query("SELECT 1 FROM world_ids WHERE id=?");
  const insert = db.query("INSERT INTO world_ids(id) VALUES(?)");
  return {
    issue(kind: string) {
      const id = newWorldId(
        kind,
        (candidate) => Boolean(exists.get(candidate)),
        bytes,
      );
      insert.run(id);
      return id;
    },
  };
}
