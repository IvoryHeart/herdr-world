import { Database } from "bun:sqlite";

/**
 * Synchronous fixture construction for logical replay, not process/power-loss
 * durability. Keep real SQLite transactions and reopen semantics, but avoid
 * fsync for every simulated transition. The prototype is restored before this
 * returns; only connections opened by this synchronous factory retain OFF.
 */
export function openWithoutSqliteSync<T>(open: () => T): T {
  const exec = Database.prototype.exec;
  Database.prototype.exec = function (sql: string) {
    if (!this.inTransaction) exec.call(this, "PRAGMA synchronous=OFF");
    return exec.call(
      this,
      sql.replace(
        /\bPRAGMA\s+synchronous\s*=\s*FULL\b/gi,
        "PRAGMA synchronous=OFF",
      ),
    );
  };
  try {
    return open();
  } finally {
    Database.prototype.exec = exec;
  }
}
