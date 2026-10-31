import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { assertSafeDataPath, publishDataFile } from "../config/data-paths";
import { writeRuntimeStatus, type AutoSyncRunStatus } from "./runtime-status";

/** Extract status only. Configuration and secrets never enter SQLite. */
export function importRuntimeStatus(
  db: Database,
  path: string,
  at: number,
  fault?: (stage: "before-commit" | "after-commit") => void,
) {
  if (db.query("SELECT 1 FROM imports WHERE name='runtime-status-json'").get())
    return;
  assertSafeDataPath(path);
  let hash = "absent";
  const entries: [string, AutoSyncRunStatus][] = [];
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    hash = createHash("sha256").update(bytes).digest("hex");
    const backup = `${path}.${hash}.runtime-status-import.bak`;
    assertSafeDataPath(backup);
    publishDataFile(backup, bytes);
    if (lstatSync(backup).nlink !== 1 || !readFileSync(backup).equals(bytes))
      throw new Error(
        "runtime status backup differs from source or is hard-linked; preserve it before repairing import",
      );
    chmodSync(backup, 0o600);
    const raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("invalid legacy settings document");
    for (const [key, value] of Object.entries(raw.workspace_auto_sync ?? {})) {
      if (!key.trim() || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>,
        status: AutoSyncRunStatus = {};
      for (const field of [
        "last_run_at",
        "last_message",
        "last_branch",
      ] as const)
        if (typeof entry[field] === "string") status[field] = entry[field];
      if (
        ["updated", "up_to_date", "skipped", "failed"].includes(
          entry.last_status as string,
        )
      )
        status.last_status =
          entry.last_status as AutoSyncRunStatus["last_status"];
      if (Object.keys(status).length) entries.push([key, status]);
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, status] of entries) writeRuntimeStatus(db, key, status);
    db.query(
      "INSERT INTO imports(name,content_hash,completed_at) VALUES('runtime-status-json',?,?)",
    ).run(hash, at);
    fault?.("before-commit");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  fault?.("after-commit");
}
