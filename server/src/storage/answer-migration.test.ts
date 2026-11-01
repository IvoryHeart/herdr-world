import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { worldMigrations, WORLD_APPLICATION_ID } from "./world-schema";
import { recordAnswerAttempt, answerAttemptEvidence } from "./answer-attempts";
import { openWorldWriter } from "./world-writer";
const ask = {
  id: "q-legacy",
  at: 1,
  actor: { label: "Fixture", verified: true },
  question: "Proceed?",
  owner_only: true,
  options: [],
  answer: { text: "Saved before this feature", by: "owner", at: 2 },
};
test("v1 upgrades preserve historical answers and make no answer sends", () => {
  const root = mkdtempSync(join(tmpdir(), "answer-migration-")),
    path = join(root, "world.sqlite");
  let writer: ReturnType<typeof openWorldWriter> | undefined;
  try {
    const db = new Database(path);
    db.exec(worldMigrations[0]);
    db.exec(
      `PRAGMA application_id=${WORLD_APPLICATION_ID}; PRAGMA user_version=1`,
    );
    db.query(
      "INSERT INTO asks(id,created_at,resolved_at,body) VALUES(?,?,?,?)",
    ).run(ask.id, 1, 2, JSON.stringify(ask));
    db.close();
    writer = openWorldWriter(path, join(root, "legacy.json"), 3000, "fixture");
    expect(writer.read().document.asks[0]?.answer).toEqual(ask.answer);
    expect(writer.read().attention).toEqual([]);
    expect(
      readdirSync(root).some((name) =>
        /^world.sqlite.v1.[a-z0-9]{8}.bak$/.test(name),
      ),
    ).toBe(true);
  } finally {
    writer?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("JSON import cannot forge recipient, answer occurrence or delivery evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "answer-import-")),
    legacy = join(root, "legacy.json");
  let writer: ReturnType<typeof openWorldWriter> | undefined;
  try {
    writeFileSync(
      legacy,
      JSON.stringify({
        version: 1,
        revision: 3,
        changes: [],
        results: [],
        asks: [
          {
            ...ask,
            recipient: { adapter: "herdr", pane_id: "replacement" },
            answer: { ...ask.answer, occurrence: "a-forged" },
            delivery: { answer: { state: "delivered" } },
          },
        ],
      }),
    );
    writer = openWorldWriter(
      join(root, "world.sqlite"),
      legacy,
      3000,
      "fixture",
    );
    const imported = writer.read().document.asks[0]!;
    expect(imported.answer).toEqual(ask.answer);
    expect(imported.recipient).toBeUndefined();
    expect(imported.delivery).toBeUndefined();
    expect(writer.read().attention).toEqual([]);
  } finally {
    writer?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline retry history is bounded while earlier uncertainty remains visible", () => {
  const db = new Database(":memory:");
  try {
    db.exec(worldMigrations.join("\n"));
    recordAnswerAttempt(
      db,
      "e-fixture",
      1,
      "uncertain",
      null,
      1000,
      "Earlier send may have happened",
    );
    for (let attempt = 2; attempt < 40; attempt++)
      recordAnswerAttempt(
        db,
        "e-fixture",
        attempt,
        "pending",
        null,
        1000 + attempt,
        "Host is offline",
      );
    expect(
      (
        db.query("SELECT count(*) AS count FROM answer_attempts").get() as {
          count: number;
        }
      ).count,
    ).toBe(9);
    const evidence = answerAttemptEvidence(db, "e-fixture", 39);
    expect(evidence.attempts).toHaveLength(8);
    expect(evidence.prior_uncertainty).toBe(true);
  } finally {
    db.close();
  }
});
