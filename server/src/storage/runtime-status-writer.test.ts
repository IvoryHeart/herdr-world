import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "status-writer-"));
  roots.push(root);
  return {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
    settings: join(root, "settings.json"),
  };
};
const open = (
  p: ReturnType<typeof fresh>,
  fault?: (stage: "before-commit" | "after-commit") => void,
) =>
  openWorldWriter(
    p.database,
    p.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    undefined,
    undefined,
    { path: p.settings, fault },
  );
function orders<T>(values: readonly T[]): T[][] {
  return values.length
    ? values.flatMap((value, index) =>
        orders(values.filter((_, i) => i !== index)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}
test("all six independent-status/refusal orderings preserve accepted rows across restart", () => {
  for (const order of orders(["a", "b", "bad"] as const)) {
    const p = fresh(),
      writer = open(p);
    let saved: ReturnType<typeof writer.read>;
    try {
      const results = writer.batch(
        order.map((key, ticket) => ({
          ticket,
          request: {
            type: "runtime-status" as const,
            key: key === "bad" ? "a" : key,
            status: {
              last_status: key === "bad" ? "invalid" : "updated",
              last_message: key,
            },
          } as any,
        })),
        1000,
      );
      for (const [i, key] of order.entries())
        if (key === "bad")
          expect(results[i]!.error).toContain("invalid auto-sync");
        else expect(results[i]!.error).toBeUndefined();
      saved = writer.read();
      expect(saved.runtimeStatus).toEqual({
        a: { last_status: "updated", last_message: "a" },
        b: { last_status: "updated", last_message: "b" },
      });
    } finally {
      writer.close();
    }
    const again = open(p);
    try {
      expect(again.read().runtimeStatus).toEqual(saved.runtimeStatus);
    } finally {
      again.close();
    }
  }
});
test("interrupted status import commits no runtime rows or marker; retry and changed-source startup are idempotent", () => {
  const p = fresh(),
    source = JSON.stringify({
      version: 1,
      custom: { synthetic_secret: "file-only" },
      workspace_auto_sync: {
        a: { enabled: true, last_status: "updated" },
        b: { last_status: "failed" },
      },
    });
  writeFileSync(p.settings, source, { mode: 0o600 });
  let interrupted = false;
  try {
    open(p, (stage) => {
      if (stage === "before-commit") throw new Error("synthetic interruption");
    });
  } catch {
    interrupted = true;
  }
  expect(interrupted).toBe(true);
  const db = new Database(p.database);
  try {
    expect(
      db.query("SELECT count(*) AS count FROM auto_sync_runs").get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query(
          "SELECT count(*) AS count FROM imports WHERE name='runtime-status-json'",
        )
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }
  const writer = open(p);
  try {
    expect(writer.read().runtimeStatus).toEqual({
      a: { last_status: "updated" },
      b: { last_status: "failed" },
    });
  } finally {
    writer.close();
  }
  writeFileSync(p.settings, "{ changed malformed source");
  let again: ReturnType<typeof open> | undefined;
  expect(() => {
    again = open(p);
  }).not.toThrow();
  try {
    expect(again!.read().runtimeStatus).toEqual({
      a: { last_status: "updated" },
      b: { last_status: "failed" },
    });
  } finally {
    again?.close();
  }
});
test("a missing source initializes once and never imports later settings history", () => {
  const p = fresh(),
    writer = open(p);
  writer.close();
  writeFileSync(
    p.settings,
    JSON.stringify({ workspace_auto_sync: { a: { last_status: "updated" } } }),
  );
  const again = open(p);
  try {
    expect(again.read().runtimeStatus).toEqual({});
  } finally {
    again.close();
  }
});
test("malformed raw bytes get an exact backup; a conflicting backup never gets replaced", () => {
  for (const source of [
    Buffer.from([0x7b, 0xff, 0x7d]),
    Buffer.from(
      JSON.stringify({
        workspace_auto_sync: { a: { last_status: "updated" } },
      }),
    ),
  ]) {
    const p = fresh(),
      hash = createHash("sha256").update(source).digest("hex"),
      backup = `${p.settings}.${hash}.runtime-status-import.bak`;
    writeFileSync(p.settings, source, { mode: 0o600 });
    const valid = source[1] !== 0xff;
    if (valid) writeFileSync(backup, "preserved conflict", { mode: 0o600 });
    let writer: ReturnType<typeof open> | undefined;
    try {
      expect(() => {
        writer = open(p);
      }).toThrow();
    } finally {
      writer?.close();
    }
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup)).toEqual(
      valid ? Buffer.from("preserved conflict") : source,
    );
    expect(readFileSync(p.settings)).toEqual(source);
    const db = new Database(p.database);
    try {
      expect(
        db.query("SELECT count(*) AS count FROM auto_sync_runs").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  }
});
