import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { assertSafeDataPath, publishDataFile } from "../config/data-paths";
import type { LedgerDocument } from "../world/world-ledger";

/** Fail closed: a malformed legacy file is never replaced with an empty store. */
export function parseLegacyLedger(text: string): LedgerDocument {
  const doc = JSON.parse(text) as LedgerDocument;
  if (
    doc?.version !== 1 ||
    !Number.isSafeInteger(doc.revision) ||
    doc.revision < 0
  )
    throw new Error("legacy ledger has invalid version or revision");
  for (const family of ["asks", "changes", "results"] as const) {
    if (!Array.isArray(doc[family]))
      throw new Error(`legacy ledger has invalid ${family}`);
    const ids = new Set<string>();
    for (const row of doc[family]) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        ids.has(row.id) ||
        !Number.isSafeInteger(row.at) ||
        typeof row.actor?.label !== "string" ||
        typeof row.actor?.verified !== "boolean"
      )
        throw new Error(`legacy ledger has invalid ${family} record`);
      ids.add(row.id);
    }
  }
  for (const ask of doc.asks) {
    if (
      typeof ask.question !== "string" ||
      !Array.isArray(ask.options) ||
      !ask.options.every((item) => typeof item === "string") ||
      typeof ask.owner_only !== "boolean" ||
      (ask.answer &&
        (typeof ask.answer.text !== "string" ||
          !Number.isSafeInteger(ask.answer.at))) ||
      (ask.dismissed && !Number.isSafeInteger(ask.dismissed.at)) ||
      (ask.withdrawn && !Number.isSafeInteger(ask.withdrawn.at))
    )
      throw new Error("legacy ledger has invalid ask");
  }
  return doc;
}

export function importLegacyLedger(
  db: Database,
  path: string,
  at: number,
  log: (message: string) => void = console.warn,
) {
  assertSafeDataPath(path);
  if (!existsSync(path)) return;
  let contents: string;
  let document: LedgerDocument;
  try {
    if (lstatSync(path).size > 32 * 1024 * 1024)
      throw new Error("legacy ledger exceeds 32 MiB import limit");
    contents = readFileSync(path, "utf8");
    document = parseLegacyLedger(contents);
  } catch (error) {
    log(
      `Legacy ledger left untouched at ${path}: ${(error as Error).message}; using current SQLite state`,
    );
    return;
  }
  const hash = createHash("sha256").update(contents).digest("hex");
  const previous = db
    .query("SELECT content_hash FROM imports WHERE name='ledger-json'")
    .get() as { content_hash: string } | null;
  if (previous?.content_hash === hash) return;
  const backup = `${path}.${hash}.sqlite-import.bak`;
  assertSafeDataPath(backup);
  publishDataFile(backup, contents);
  if (
    lstatSync(backup).nlink !== 1 ||
    readFileSync(backup, "utf8") !== contents
  )
    throw new Error(
      "legacy ledger backup differs from import source or is hard-linked; preserve it before repairing import",
    );
  chmodSync(backup, 0o600);
  const counts = { asks: 0, changes: 0, results: 0 };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const ask of document.asks)
      counts.asks += db
        .query(
          "INSERT OR IGNORE INTO asks(id,created_at,resolved_at,body) VALUES(?,?,?,?)",
        )
        .run(
          ask.id,
          ask.at,
          ask.answer?.at ?? ask.dismissed?.at ?? ask.withdrawn?.at ?? null,
          // A legacy import cannot attest a verified answer recipient.
          JSON.stringify({
            ...ask,
            recipient: undefined,
            delivery: undefined,
            ...(ask.answer
              ? {
                  answer: {
                    text: ask.answer.text,
                    at: ask.answer.at,
                    by: ask.answer.by,
                  },
                }
              : {}),
          }),
        ).changes;
    for (const [table, family] of [
      ["results", "results"],
      ["ledger_changes", "changes"],
    ] as const)
      for (const row of document[family])
        counts[family] += db
          .query(
            `INSERT OR IGNORE INTO ${table}(id,created_at,body) VALUES(?,?,?)`,
          )
          .run(row.id, row.at, JSON.stringify(row)).changes;
    db.query("UPDATE ledger_meta SET revision=max(revision,?)+1").run(
      document.revision,
    );
    db.query(
      "INSERT INTO imports(name,content_hash,completed_at) VALUES('ledger-json',?,?) ON CONFLICT(name) DO UPDATE SET content_hash=excluded.content_hash,completed_at=excluded.completed_at",
    ).run(hash, at);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  log(
    `Imported missing legacy ledger records: ${counts.asks} asks, ${counts.results} results, ${counts.changes} changes; backup ${backup}`,
  );
}
