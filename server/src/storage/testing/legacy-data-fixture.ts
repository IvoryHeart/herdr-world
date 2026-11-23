// Testing only: a synthetic data folder as a pre-SQLite World left it.
// Preview use: bun server/src/storage/testing/legacy-data-fixture.ts <data-dir>
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seededProfiles } from "../../agent/profile-store";
import { resolveDataPaths } from "../../config/data-paths";
import { BoardStore } from "../../world/board-store";

export const LEGACY_FIXTURE_ASK = {
  id: "q-legacy-fixture",
  at: 1000,
  actor: { label: "Synthetic agent", verified: false },
  question: "Legacy fixture: is this question still here after the upgrade?",
  options: ["Yes", "No"],
  owner_only: true,
};

export function writePreSqliteFolder(root: string, snapshots = 0) {
  const paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
  if (existsSync(join(root, "world.sqlite")))
    throw new Error(`${root} already has world.sqlite; use an empty folder`);
  mkdirSync(join(root, "boards"), { recursive: true, mode: 0o700 });
  new BoardStore(paths.board).patch([
    { op: "group.create", id: "legacy", kind: "pod", name: "Legacy pod" },
    {
      op: "note.put",
      note: {
        id: "n-legacy",
        text: "Legacy note from before SQLite",
        color: "yellow",
        x: 40,
        y: 40,
      },
    },
  ]);
  writeFileSync(
    paths.ledger,
    JSON.stringify({
      version: 1,
      revision: 4,
      asks: [LEGACY_FIXTURE_ASK],
      changes: [],
      results: [],
    }),
    { mode: 0o600 },
  );
  writeFileSync(paths.agentProfiles, JSON.stringify(seededProfiles()), {
    mode: 0o600,
  });
  writeFileSync(`${paths.board}.bak`, "older synthetic board copy");
  writeFileSync(`${paths.agentProfiles}.before-terminal-settings`, "{}");
  // Stand-ins named like schema snapshots, oldest first.
  for (let version = 1; version <= snapshots; version++) {
    const path = join(root, `world.sqlite.v${version}.fixture${version}.bak`);
    writeFileSync(path, "synthetic snapshot stand-in", { mode: 0o600 });
    utimesSync(path, 1000 + version, 1000 + version);
  }
  return paths;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("usage: legacy-data-fixture.ts <data-dir>");
  writePreSqliteFolder(root, 5);
  console.log(`Wrote a synthetic pre-SQLite data folder at ${root}`);
}
