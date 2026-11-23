// Testing only. Seed an empty preview: bun server/src/storage/testing/leftovers-fixture.ts <data-dir> [13|14|15|16]
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { seededProfiles } from "../../agent/profile-store";
import { resolveDataPaths } from "../../config/data-paths";
import { migrateWorldDatabase, worldMigrations } from "../world-schema";
import type { LedgerChange } from "../../world/world-ledger";

export const fixtureChanges: LedgerChange[] = [
  {
    id: "c-undone",
    at: 1,
    actor: { label: "Synthetic builder", verified: false },
    command: "board card pin",
    summary: "earlier pin",
    undo: [{ op: "layout.set", unpinned: ["synthetic:tab"] }],
    undone_by: "c-undo",
  },
  {
    id: "c-undo",
    at: 2,
    actor: { label: "Synthetic builder", verified: false },
    command: "undo",
    summary: "undid c-undone",
    undo: null,
  },
  {
    id: "c-probe",
    at: 3,
    actor: { label: "Synthetic builder", verified: false },
    command: "board card colour",
    summary: "colour changed",
    undo: [{ op: "card.color", key: "synthetic:tab", color: "blue" }],
    redo: [{ op: "card.color", key: "synthetic:tab", color: "pink" }],
    expect: {
      probe: { aspect: "colour", key: "synthetic:tab" },
      value: JSON.stringify("pink"),
    },
  },
  {
    id: "c-regroup",
    at: 4,
    actor: { label: "Synthetic builder", verified: false },
    command: "board card ungroup",
    summary: "ungrouped",
    undo: [],
    regroup: {
      ref: { connection_id: "synthetic", terminal_id: "terminal" },
      members: null,
    },
  },
];

export function writeLeftoversFolder(root: string, version = 15, scale = true) {
  const paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
  const database = join(root, "world.sqlite");
  if (existsSync(database)) throw new Error("Use an empty fixture folder");
  if (![13, 14, 15, 16].includes(version))
    throw new Error("Expected schema 13–16");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const db = new Database(database);
  try {
    migrateWorldDatabase(db, database, worldMigrations.slice(0, version), 1000);
    db.transaction(() => {
      const profile = seededProfiles();
      db.exec("INSERT INTO profile_store_meta VALUES(1,7,3,NULL,NULL)");
      profile.profiles.forEach((value, position) => {
        db.query("INSERT INTO world_ids VALUES(?)").run(value.id);
        db.query("INSERT INTO agent_profiles VALUES(?,?,?)").run(
          value.id,
          position,
          JSON.stringify(value),
        );
      });
      db.query("INSERT INTO profile_chimes VALUES(1,?)").run(
        JSON.stringify(profile.chimes),
      );
      db.query(
        "INSERT INTO profile_legacy_assignments VALUES(0,'synthetic','terminal',?)",
      ).run(profile.profiles[0]!.id);
      db.exec(
        "INSERT INTO profile_imported_connections VALUES('synthetic',0); INSERT INTO imports VALUES('ledger-json','fixture-hash',1); INSERT INTO board_meta VALUES(1,7,0,0,0)",
      );
      db.query(
        "INSERT INTO board_colors VALUES('synthetic:tab',0,7,?,NULL,NULL)",
      ).run(JSON.stringify("pink"));
      db.query(
        "INSERT INTO board_notes VALUES('n-fixture',0,7,?,NULL,NULL)",
      ).run(
        JSON.stringify({
          id: "n-fixture",
          text: "Storage upgrade fixture",
          color: "yellow",
          x: 40,
          y: 40,
        }),
      );
      for (const change of fixtureChanges)
        db.query("INSERT INTO ledger_changes VALUES(?,?,?)").run(
          change.id,
          change.at,
          JSON.stringify(change),
        );
      db.exec(
        "INSERT INTO world_ids VALUES('c-review'); INSERT INTO retired_completion_reviews VALUES('c-review','synthetic','terminal',1,0,1,'{}')",
      );
      for (let i = 0; i < (scale ? 300 : 1); i++) {
        const ask = {
          id: `q-fixture-${i}`,
          at: 1000,
          actor: { label: "Synthetic agent", verified: false },
          question: `Upgrade fixture question ${i + 1}`,
          options: ["Keep"],
          owner_only: true,
        };
        db.query("INSERT INTO asks VALUES(?,1000,NULL,?)").run(
          ask.id,
          JSON.stringify(ask),
        );
      }
      for (let i = 0; i < (scale ? 400 : 1); i++)
        db.query(
          "INSERT INTO outbox(id,operation_id,kind,record_id,recovery,state,due_at,created_at,resolved_at) VALUES(?,? ,?,'q-fixture-0','opaque','cancelled',1000,1000,1000)",
        ).run(`e-fixture-${i}`, `o-fixture-${i}`, `fixture-${i}`);
      for (let i = 0; i < (scale ? 180 : 1); i++)
        db.query("INSERT INTO board_offsets VALUES(?,?,7,?,NULL,NULL)").run(
          `synthetic:tab-${i}`,
          i,
          JSON.stringify({ x: i, y: i }),
        );
      for (let i = 0; i < (scale ? 500 : 1); i++) {
        const id = `d-fixture-${i}`,
          binding = `b-fixture-${i}`;
        db.query("INSERT INTO world_ids VALUES(?)").run(id);
        db.query("INSERT INTO world_ids VALUES(?)").run(binding);
        db.query("INSERT INTO world_bindings VALUES(?,?, 'target',?)").run(
          binding,
          id,
          JSON.stringify({
            id: binding,
            record_id: id,
            slot: "target",
            adapter: "herdr",
            instance: "synthetic",
            kind: "pane",
            native_id: `pane-${i}`,
            evidence: { terminals: [`terminal-${i}`], session: "a".repeat(64) },
            policy: "desk",
            state: "unresolved",
            revision: 0,
            created_at: 1000,
            checked_at: 1000,
          }),
        );
        db.query("INSERT INTO terminal_marks VALUES(?,'desk',?,0,?,0)").run(
          id,
          binding,
          JSON.stringify({
            reviewed_stop: null,
            opened_at: null,
            stopped_at: 1000,
          }),
        );
      }
      if (version >= 14)
        for (let i = 0; i < (scale ? 3000 : 1); i++) {
          const resident = {
            id: `a-fixture-${i}`,
            harness: "codex",
            session_id: `session-${i}`,
            name: `Fixture resident ${i + 1}`,
            moved_out_at: 1000,
            first_seen_at: 1,
            connection_id: "synthetic",
            terminal_id: `terminal-${i}`,
            runtime: "herdr",
            move_out: "ended",
          };
          const body = JSON.stringify(resident);
          if (version === 14)
            db.query("INSERT INTO apartment_residents VALUES(?,1000,?)").run(
              resident.id,
              body,
            );
          else
            db.query("INSERT INTO apartment_residents VALUES(?,1000,?,?)").run(
              resident.id,
              body,
              `codex/session-${i}`,
            );
        }
    })();
  } finally {
    db.close();
  }
  return {
    database,
    ledger: paths.ledger,
    profiles: paths.agentProfiles,
    board: paths.board,
  };
}

if (import.meta.main) {
  if (!process.argv[2])
    throw new Error("usage: leftovers-fixture.ts <data-dir> [13|14|15|16]");
  writeLeftoversFolder(process.argv[2], Number(process.argv[3] ?? 15));
  console.log("Wrote populated synthetic storage upgrade fixture");
}
