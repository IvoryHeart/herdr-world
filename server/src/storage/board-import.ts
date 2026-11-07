import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { assertSafeDataPath, publishDataFile } from "../config/data-paths";
import { emptyBoardDocument, parseBoardDocument } from "../world/board-store";
import type { createBindingWriter } from "./world-bindings";
import { readBoard, writeBoard } from "./world-board";
export function importBoard(
  db: Database,
  path: string,
  at: number,
  bindings: ReturnType<typeof createBindingWriter>,
  fault?: (stage: "before-commit" | "after-commit") => void,
) {
  if (readBoard(db)) return;
  assertSafeDataPath(path);
  let doc = emptyBoardDocument(),
    hash = "absent";
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    hash = createHash("sha256").update(bytes).digest("hex");
    const backup = `${path}.${hash}.sqlite-import.bak`;
    assertSafeDataPath(backup);
    publishDataFile(backup, bytes);
    if (lstatSync(backup).nlink !== 1 || !readFileSync(backup).equals(bytes))
      throw new Error(
        "Board backup differs from source or is hard-linked; preserve it before repairing import",
      );
    chmodSync(backup, 0o600);
    doc = parseBoardDocument(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    writeBoard(db, doc, bindings, at);
    db.query(
      "INSERT INTO imports(name,content_hash,completed_at) VALUES('board-json',?,?)",
    ).run(hash, at);
    fault?.("before-commit");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  fault?.("after-commit");
}
