import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateWorldDatabase, worldMigrations } from "../world-schema";
import { deskSessionFingerprint } from "../../world/desk-observation";

export const legacySession = (index = 0) => ({
  source: "synthetic",
  agent: "codex",
  kind: "id",
  value: `legacy-session-${index}`,
});
export function legacyPane(index = 0, known = true) {
  return {
    pane_id: `pane-${index}`,
    terminal_id: `terminal-${index}`,
    agent: "codex",
    agent_session: known ? legacySession(index) : null,
    agent_status: "done",
    state_change_seq: 4,
    last_activity_at: 1000,
  };
}

/** Historical schema-9 input, including the then-valid retired row/policy kind. */
export function legacyReviewFixture(
  receipts: { index: number; known?: boolean; sequence?: number | null }[] = [
    { index: 0 },
  ],
) {
  const root = mkdtempSync(join(tmpdir(), "legacy-reviews-"));
  const paths = {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
  const db = new Database(paths.database, { strict: true });
  migrateWorldDatabase(db, paths.database, worldMigrations.slice(0, 9));
  let counter = 0;
  db.exec("BEGIN");
  function insert(
    kind: "desk" | "watchlist" | "completion-seen",
    index: number,
    known = true,
    sequence: number | null = 4,
  ) {
    const suffix = String(++counter).padStart(8, "0"),
      id = `${kind === "desk" ? "d" : kind === "watchlist" ? "w" : "c"}-${suffix}`,
      bindingId = `b-${suffix}`;
    db.query("INSERT INTO world_ids(id) VALUES(?)").run(id);
    db.query("INSERT INTO world_ids(id) VALUES(?)").run(bindingId);
    const binding = {
      id: bindingId,
      record_id: id,
      slot: "target",
      revision: 3,
      state: "attached",
      checked_at: 1000,
      policy: kind,
      adapter: "herdr",
      instance: "alpha",
      kind: "pane",
      native_id: `pane-${index}`,
      evidence: {
        terminals: [`terminal-${index}`],
        ...(kind !== "watchlist" && known
          ? { session: deskSessionFingerprint(legacySession(index)) }
          : {}),
      },
    };
    const body =
      kind === "desk"
        ? {
            reviewed_stop: null,
            stopped_at: 1000,
            observed_stop_id: `stop-${index}`,
            opened_at: 1000,
            stateChangeSeq: 4,
          }
        : kind === "watchlist"
          ? { label: "Synthetic watch" }
          : sequence === null
            ? {}
            : { stateChangeSeq: sequence };
    db.query(
      "INSERT INTO world_bindings(id,record_id,slot,body) VALUES(?,?,?,?)",
    ).run(bindingId, id, "target", JSON.stringify(binding));
    db.query(
      "INSERT INTO terminal_marks(id,kind,binding_id,revision,body,open_order) VALUES(?,?,?,?,?,?)",
    ).run(
      id,
      kind,
      bindingId,
      2,
      JSON.stringify(body),
      kind === "desk" ? 1 : 0,
    );
    return id;
  }
  insert("desk", 0);
  insert("watchlist", 0);
  const ids = receipts.map((receipt) =>
    insert(
      "completion-seen",
      receipt.index,
      receipt.known !== false,
      receipt.sequence === undefined ? 4 : receipt.sequence,
    ),
  );
  db.exec("COMMIT");
  const protectedRows = db
    .query(
      "SELECT m.rowid,m.id,m.kind,m.binding_id,m.revision,m.body,m.open_order,b.body AS binding FROM terminal_marks m JOIN world_bindings b ON b.id=m.binding_id WHERE m.kind!='completion-seen' ORDER BY m.rowid",
    )
    .all();
  db.close();
  return { root, paths, ids, protectedRows };
}
