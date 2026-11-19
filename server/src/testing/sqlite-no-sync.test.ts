import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openWorldWriter } from "../storage/world-writer";
import { openWithoutSqliteSync } from "./sqlite-no-sync";

test("logical replay opts out of sync without changing normal writers or leaking its opener", () => {
  const root = mkdtempSync(join(tmpdir(), "sqlite-no-sync-"));
  const exec = Database.prototype.exec;
  const open = (name: string) =>
    openWorldWriter(join(root, name), join(root, "legacy.json"), 1000);
  const inspect = (writer: ReturnType<typeof open>) =>
    writer.batch([{ ticket: 1, request: { type: "inspect" } }], 1000)[0]!
      .result;
  try {
    const fast = openWithoutSqliteSync(() => open("logical.sqlite"));
    try {
      expect(inspect(fast)).toMatchObject({
        synchronous: 0,
        journal_mode: "wal",
        integrity: "ok",
      });
    } finally {
      fast.close();
    }
    expect(Database.prototype.exec).toBe(exec);
    expect(() =>
      openWithoutSqliteSync(() => {
        throw new Error("fixture refused");
      }),
    ).toThrow("fixture refused");
    expect(Database.prototype.exec).toBe(exec);
    const normal = open("normal.sqlite");
    try {
      expect(inspect(normal)).toMatchObject({
        synchronous: 2,
        journal_mode: "wal",
        integrity: "ok",
      });
    } finally {
      normal.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
