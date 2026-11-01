import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { assertSafeDataPath, publishDataFile } from "../config/data-paths";
import { parseProfilesDocument, seededProfiles } from "../agent/profile-store";
import { readProfiles, writeProfiles } from "./world-profiles";

/** One-way import. A completed family never consults the retained JSON again. */
export function importLegacyProfiles(
  db: Database,
  path: string,
  at: number,
  fault?: (stage: "before-commit" | "after-commit") => void,
) {
  if (readProfiles(db)) return;
  assertSafeDataPath(path);
  let document = seededProfiles(),
    hash = "absent";
  if (existsSync(path)) {
    if (lstatSync(path).size > 4 * 1024 * 1024)
      throw new Error("legacy agent profiles exceed the 4 MiB import limit");
    const contents = readFileSync(path);
    hash = createHash("sha256").update(contents).digest("hex");
    const backup = `${path}.${hash}.sqlite-import.bak`;
    assertSafeDataPath(backup);
    publishDataFile(backup, contents);
    if (lstatSync(backup).nlink !== 1 || !readFileSync(backup).equals(contents))
      throw new Error(
        "legacy profiles backup differs from its source or is hard-linked; preserve it before repairing import",
      );
    chmodSync(backup, 0o600);
    // Unlike the live JSON store's quarantine path, migration never substitutes
    // starters for unreadable input: keep the backup/source and stop safely.
    document = parseProfilesDocument(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contents)),
    );
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    writeProfiles(db, document);
    db.query(
      "INSERT INTO imports(name,content_hash,completed_at) VALUES('agent-profiles-json',?,?)",
    ).run(hash, at);
    fault?.("before-commit");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  fault?.("after-commit");
}
