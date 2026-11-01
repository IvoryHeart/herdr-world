import type { Database } from "bun:sqlite";
import { StorageWriteRejected, type StorageRequest } from "./world-protocol";

export type AutoSyncRunStatus = Pick<
  import("../config/gui-settings").GuiWorkspaceAutoSyncSettings,
  "last_run_at" | "last_status" | "last_message" | "last_branch"
>;
export type RuntimeStatusPort = {
  get(key: string): AutoSyncRunStatus | undefined;
  list(): Record<string, AutoSyncRunStatus>;
  put(key: string, status: AutoSyncRunStatus): Promise<AutoSyncRunStatus>;
  close(): void;
};
const fields = [
  "last_run_at",
  "last_status",
  "last_message",
  "last_branch",
] as const;
export const runtimeStatusMigration = `CREATE TABLE auto_sync_runs (
 settings_key TEXT PRIMARY KEY NOT NULL CHECK(length(settings_key)>0),
 last_run_at TEXT, last_status TEXT CHECK(last_status IN ('updated','up_to_date','skipped','failed')),
 last_message TEXT, last_branch TEXT
);`;
export function runStatus(value: unknown): AutoSyncRunStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid auto-sync run status");
  const input = value as Record<string, unknown>,
    status: Record<string, string> = {};
  for (const field of fields) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string")
      throw new Error(`invalid auto-sync ${field}`);
    status[field] = input[field];
  }
  if (
    status.last_status !== undefined &&
    !["updated", "up_to_date", "skipped", "failed"].includes(status.last_status)
  )
    throw new Error("invalid auto-sync last_status");
  if (!Object.keys(status).length)
    throw new Error("empty auto-sync run status");
  return status as AutoSyncRunStatus;
}
export function readRuntimeStatus(
  db: Database,
): Record<string, AutoSyncRunStatus> | null {
  if (!db.query("SELECT 1 FROM imports WHERE name='runtime-status-json'").get())
    return null;
  return Object.fromEntries(
    (
      db.query("SELECT * FROM auto_sync_runs ORDER BY settings_key").all() as ({
        settings_key: string;
      } & Record<(typeof fields)[number], string | null>)[]
    ).map((row) => [
      row.settings_key,
      Object.fromEntries(
        fields
          .filter((field) => row[field] !== null)
          .map((field) => [field, row[field]]),
      ),
    ]),
  );
}
export function writeRuntimeStatus(
  db: Database,
  key: string,
  value: unknown,
): AutoSyncRunStatus {
  if (typeof key !== "string" || !key.trim())
    throw new Error("invalid auto-sync settings key");
  const status = runStatus(value);
  db.query(`INSERT INTO auto_sync_runs VALUES(?,?,?,?,?) ON CONFLICT(settings_key) DO UPDATE SET
 last_run_at=excluded.last_run_at,last_status=excluded.last_status,last_message=excluded.last_message,last_branch=excluded.last_branch`).run(
    key,
    ...fields.map((field) => status[field] ?? null),
  );
  return status;
}
export function createRuntimeStatusPort(
  initial: Record<string, AutoSyncRunStatus>,
  request: <T>(operation: StorageRequest) => Promise<T>,
): RuntimeStatusPort {
  const cache = new Map(Object.entries(structuredClone(initial)));
  let closed = false;
  return {
    get: (key) => {
      const row = cache.get(key);
      return row && structuredClone(row);
    },
    list: () =>
      Object.fromEntries(
        [...cache].map(([key, row]) => [key, structuredClone(row)]),
      ),
    put: async (key, status) => {
      if (closed) throw new StorageWriteRejected("World storage is closed");
      const saved = await request<AutoSyncRunStatus>({
        type: "runtime-status",
        key,
        status: structuredClone(status),
      });
      cache.set(key, saved);
      return structuredClone(saved);
    },
    close: () => {
      closed = true;
    },
  };
}
