import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProfilesDocument, seededProfiles } from "../agent/profile-store";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage } from "../service/storage";
import { systemClock, systemScheduler } from "../service/ports";
import { BoardStore } from "../world/board-store";
import { importBoard } from "./board-import";
import { archiveLegacyFiles, moveIntoLegacy } from "./legacy-archive";
import { importLegacyProfiles } from "./profile-import";
import { createBindingWriter } from "./world-bindings";
import { createWorldIds } from "./world-ids";
import { importLegacyLedger } from "./world-import";
import {
  LEGACY_FIXTURE_ASK,
  writePreSqliteFolder,
} from "./testing/legacy-data-fixture";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-archive-"));
  roots.push(root);
  return resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
};
const ports = { clock: systemClock, scheduler: systemScheduler };
const preSqliteFolder = () => writePreSqliteFolder(fresh().root);

async function dump(paths: ReturnType<typeof fresh>) {
  const storage = await openStorage(paths, ports);
  try {
    return {
      board: storage.board().get(),
      profiles: storage.profiles().get(),
      asks: storage.ledger().get().asks,
    };
  } finally {
    await storage.close();
  }
}

test("a pre-SQLite folder imports once, moves its JSON to legacy/ and reopens identically", async () => {
  const paths = preSqliteFolder();
  const board = new BoardStore(paths.board).get();
  const sources = [paths.board, paths.ledger, paths.agentProfiles].map((path) =>
    readFileSync(path, "utf8"),
  );
  const first = await dump(paths);
  expect(first.board).toEqual(board);
  expect(first.profiles).toEqual(parseProfilesDocument(seededProfiles()));
  expect(first.asks.map((row) => row.id)).toEqual([LEGACY_FIXTURE_ASK.id]);

  const legacy = join(paths.root, "legacy");
  for (const path of [paths.board, paths.ledger, paths.agentProfiles])
    expect(existsSync(path)).toBe(false);
  expect(
    ["board.json", "world-ledger.json", "agent-profiles.json"].map((name) =>
      readFileSync(join(legacy, name), "utf8"),
    ),
  ).toEqual(sources);
  const moved = readdirSync(legacy);
  expect(moved).toContain("board.json.bak");
  expect(moved).toContain("agent-profiles.json.before-terminal-settings");
  expect(moved).toContain("README.md");
  expect(
    moved.filter((name) => name.endsWith(".sqlite-import.bak")),
  ).toHaveLength(3);
  expect(readdirSync(join(paths.root, "boards"))).toEqual([]);

  // Reopening with the files gone keeps the same semantic state.
  expect(await dump(paths)).toEqual(first);
  expect(readdirSync(legacy)).toEqual(moved);
});

test("older importers skip the moved files and leave the database unchanged", async () => {
  const paths = preSqliteFolder();
  await dump(paths);
  const database = join(paths.root, "world.sqlite");
  const db = new Database(database, { strict: true });
  try {
    const snapshot = () =>
      ["asks", "agent_profiles", "board_meta", "imports"].map((table) =>
        db.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    // Older binaries ran these importers without the import-once marker.
    db.exec("DELETE FROM imports WHERE name='ledger-json'");
    const withoutMarker = snapshot();
    const ids = createWorldIds(db);
    importLegacyLedger(db, paths.ledger, 2000);
    importLegacyProfiles(db, paths.agentProfiles, 2000);
    importBoard(db, paths.board, 2000, createBindingWriter(db, ids));
    expect(snapshot()).toEqual(withoutMarker);
    for (const path of [paths.board, paths.ledger, paths.agentProfiles])
      expect(existsSync(path)).toBe(false);
  } finally {
    db.close();
  }
});

test("schema snapshots beyond the newest three move to legacy/ and are never deleted", () => {
  const root = fresh().root;
  const database = join(root, "world.sqlite");
  const names = [
    "world.sqlite.v9.aaa.bak",
    "world.sqlite.v10.bbb.bak",
    "world.sqlite.v11.ccc.bak",
    "world.sqlite.v11.ddd.bak",
    "world.sqlite.v12.eee.bak",
  ];
  names.forEach((name, index) => {
    writeFileSync(join(root, name), name);
    utimesSync(join(root, name), 1000 + index, 1000 + index);
  });
  const db = new Database(":memory:");
  try {
    archiveLegacyFiles(db, database, [], () => {});
  } finally {
    db.close();
  }
  expect(
    readdirSync(root)
      .filter((name) => name.endsWith(".bak"))
      .sort(),
  ).toEqual([
    "world.sqlite.v11.ccc.bak",
    "world.sqlite.v11.ddd.bak",
    "world.sqlite.v12.eee.bak",
  ]);
  for (const name of ["world.sqlite.v9.aaa.bak", "world.sqlite.v10.bbb.bak"])
    expect(readFileSync(join(root, "legacy", name), "utf8")).toBe(name);
});

test("a move interrupted after linking finishes without another copy", () => {
  const root = fresh().root;
  const source = join(root, "agent-profiles.json");
  writeFileSync(source, "synthetic");
  mkdirSync(join(root, "legacy"));
  linkSync(source, join(root, "legacy", "agent-profiles.json"));
  expect(moveIntoLegacy(source, join(root, "legacy"))).toBe(
    join(root, "legacy", "agent-profiles.json"),
  );
  expect(existsSync(source)).toBe(false);
  expect(readdirSync(join(root, "legacy"))).toEqual(["agent-profiles.json"]);
});
