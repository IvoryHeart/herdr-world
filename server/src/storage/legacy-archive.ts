import type { Database } from "bun:sqlite";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertSafeDataPath, publishDataFile } from "../config/data-paths";

/** Schema snapshots kept beside world.sqlite; older ones move to legacy/. */
export const KEPT_SCHEMA_SNAPSHOTS = 3;

const README = `# World legacy files

World imported these files into world.sqlite, or they are older schema
snapshots. World no longer reads them and never deletes them; remove them
yourself when you no longer need them.

Rollback: stop World and restore the world.sqlite.v<N>.<id>.bak snapshot that
the error names (it may sit beside world.sqlite or in this folder).
`;

export type LegacySource = { path: string; marker: string };

function lstatIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  try {
    const fd = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
    );
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Best effort, as for other private data files.
  }
}

/** Same directory by identity, so symlinks and case folding cannot hide it. */
function sameDirectory(a: string, b: string) {
  const left = statSync(a);
  const right = statSync(b);
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Move by hard link plus verify, then drop only the old name: the bytes are
 * never copied or deleted. A name taken by other content gets a numbered
 * suffix; a crash after linking is finished on the next open. A file already
 * in `legacy` stays put and returns null.
 */
export function moveIntoLegacy(source: string, legacy: string) {
  assertSafeDataPath(source);
  const before = lstatSync(source);
  if (!before.isFile()) throw new Error(`not a regular file: ${source}`);
  mkdirSync(legacy, { recursive: true, mode: 0o700 });
  // A source configured inside legacy/ is its own target; unlinking it would
  // remove the only name.
  if (sameDirectory(dirname(source), legacy)) return null;
  for (let index = 0; index < 1000; index++) {
    const target = join(
      legacy,
      index ? `${basename(source)}.${index}` : basename(source),
    );
    assertSafeDataPath(target);
    let existing = lstatIfPresent(target);
    if (!existing) {
      try {
        linkSync(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      existing = lstatSync(target);
    }
    if (existing.dev !== before.dev || existing.ino !== before.ino) continue;
    const after = lstatSync(source);
    if (after.ino !== before.ino || after.size !== existing.size)
      throw new Error(`legacy move could not be verified for ${source}`);
    unlinkSync(source);
    syncDirectory(legacy);
    syncDirectory(dirname(source));
    return target;
  }
  throw new Error(`no free legacy name for ${source}`);
}

/** Backup copies of an imported file, e.g. `board.json.<hash>.sqlite-import.bak`. */
function backupCopies(path: string) {
  const name = basename(path);
  let names: string[];
  try {
    names = readdirSync(dirname(path));
  } catch {
    return [];
  }
  return names
    .filter(
      (entry) =>
        entry.startsWith(`${name}.`) &&
        /(^|\.)(bak(-[^/]*)?|before-terminal-settings)$/.test(
          entry.slice(name.length + 1),
        ),
    )
    .map((entry) => join(dirname(path), entry));
}

/**
 * `world.sqlite.v<N>.<id>.bak` snapshots, newest first by write time: after a
 * restore and re-upgrade the latest snapshot can carry a lower version.
 */
export function schemaSnapshots(database: string) {
  const prefix = `${basename(database)}.v`;
  return readdirSync(dirname(database))
    .flatMap((name) => {
      const match = name.startsWith(prefix)
        ? /^(\d+)\.[A-Za-z0-9_-]+\.bak$/.exec(name.slice(prefix.length))
        : null;
      const stat = match && lstatSync(join(dirname(database), name));
      return stat?.isFile()
        ? [{ name, version: Number(match![1]), mtime: stat.mtimeMs }]
        : [];
    })
    .sort(
      (a, b) =>
        b.mtime - a.mtime ||
        b.version - a.version ||
        b.name.localeCompare(a.name),
    )
    .map(({ name }) => join(dirname(database), name));
}

/**
 * After a family's import is recorded, its JSON is never read again: move it
 * and its backup copies to `<data>/legacy/`, with schema snapshots beyond the
 * newest three. Failures leave files in place and never block World.
 */
export function archiveLegacyFiles(
  db: Database,
  database: string,
  sources: readonly LegacySource[],
  log: (message: string) => void = console.warn,
) {
  const legacy = join(dirname(database), "legacy");
  const candidates: string[] = [];
  // Discovery failures (an unreadable or replaced path) are as nonfatal as a
  // failed move: the committed SQLite state stays authoritative.
  const discover = (label: string, find: () => string[]) => {
    try {
      candidates.push(...find());
    } catch (error) {
      log(`Legacy files not checked at ${label}: ${(error as Error).message}`);
    }
  };
  for (const { path, marker } of sources)
    discover(path, () =>
      db.query("SELECT 1 FROM imports WHERE name=?").get(marker)
        ? [...(lstatIfPresent(path) ? [path] : []), ...backupCopies(path)]
        : [],
    );
  discover(dirname(database), () =>
    schemaSnapshots(database).slice(KEPT_SCHEMA_SNAPSHOTS),
  );
  let moved = 0;
  for (const path of candidates) {
    try {
      if (moveIntoLegacy(path, legacy)) moved++;
    } catch (error) {
      log(`Legacy file left in place at ${path}: ${(error as Error).message}`);
    }
  }
  if (!moved) return;
  try {
    publishDataFile(join(legacy, "README.md"), README);
  } catch {
    // The moved files are intact; the note is only a courtesy.
  }
  log(`Moved ${moved} imported or older World files to ${legacy}`);
}
