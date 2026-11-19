import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage, type WorldStorage } from "../service/storage";
import { systemClock, systemScheduler } from "../service/ports";
import {
  createApartmentsPort,
  memoryApartmentsPort,
  parseApartmentMoveIn,
  readApartments,
  writeApartments,
  type ApartmentMoveIn,
} from "./apartments";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import type { StorageRequest } from "./world-protocol";

const roots: string[] = [];
const stores: WorldStorage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function folder() {
  const root = mkdtempSync(join(tmpdir(), "hcw-apartments-"));
  roots.push(root);
  return root;
}
function database() {
  const path = join(folder(), "world.sqlite");
  const db = new Database(path);
  migrateWorldDatabase(db, path, worldMigrations, 0);
  return db;
}

const DAY = 24 * 60 * 60 * 1000;
const resident = (
  name: string,
  movedOut: number,
  extra: Partial<ApartmentMoveIn> = {},
): ApartmentMoveIn => ({
  name,
  harness: "claude",
  cwd: "/srv/example/project-alpha",
  room: "alpha",
  tab: "builder",
  connection_id: "local",
  connection_label: "This computer",
  runtime: "herdr",
  terminal_id: `t-${name}`,
  first_seen_at: movedOut - 60_000,
  moved_out_at: movedOut,
  move_out: "ended",
  summary: `Synthetic summary for ${name}`,
  last_report: null,
  links: [{ kind: "pr", number: 42, repo: "example/repo" }],
  session_id: "0f0e0d0c-0000-4000-8000-000000000001",
  ...extra,
});

describe("apartment residents live in World's SQLite", () => {
  test("a resident survives a round trip with its links bounded and deduplicated", () => {
    const db = database();
    try {
      const links = [
        { kind: "pr", number: 7 },
        { kind: "pr", number: 7 },
        ...Array.from({ length: 30 }, (_, index) => ({
          kind: "issue",
          number: index + 1,
        })),
      ] as ApartmentMoveIn["links"];
      const { residents } = writeApartments(
        db,
        { type: "move-in", resident: resident("ada", 10 * DAY, { links }) },
        10 * DAY,
      );
      expect(residents).toHaveLength(1);
      expect(residents[0]!.id).toMatch(/^r-/);
      expect(residents[0]!.links).toHaveLength(20);
      expect(residents[0]!.links[0]).toEqual({ kind: "pr", number: 7 });
      expect(readApartments(db)).toEqual(residents);
    } finally {
      db.close();
    }
  });

  test("retention moves out the oldest by age, then by capacity; evict removes by ID", () => {
    const db = database();
    try {
      const bounds = { capacity: 2, retention_ms: 30 * DAY };
      const at = 100 * DAY;
      writeApartments(
        db,
        { type: "move-in", resident: resident("old", at - 40 * DAY) },
        at,
        bounds,
      );
      expect(readApartments(db)).toEqual([]);
      for (const [name, day] of [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ] as const)
        writeApartments(
          db,
          { type: "move-in", resident: resident(name, at - 10 * DAY + day) },
          at,
          bounds,
        );
      expect(readApartments(db).map((row) => row.name)).toEqual(["b", "c"]);
      const b = readApartments(db)[0]!.id;
      const { residents } = writeApartments(
        db,
        { type: "evict", ids: [b, "r-unknown"] },
        at,
        bounds,
      );
      expect(residents.map((row) => row.name)).toEqual(["c"]);
    } finally {
      db.close();
    }
  });

  test("a report read after the move-in is added to that resident only", () => {
    const db = database();
    try {
      const at = 10 * DAY;
      const { residents } = writeApartments(
        db,
        { type: "move-in", resident: resident("ada", at) },
        at,
      );
      const id = residents[0]!.id;
      const after = writeApartments(
        db,
        { type: "report", id, last_report: "Opened PR #42" },
        at,
      ).residents;
      expect(after).toEqual([
        { ...residents[0]!, last_report: "Opened PR #42" },
      ]);
      // A resident evicted meanwhile is not brought back.
      writeApartments(db, { type: "evict", ids: [id] }, at);
      expect(
        writeApartments(db, { type: "report", id, last_report: "late" }, at)
          .residents,
      ).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("concurrent move-ins each get their own resident, so reports land on the right one", async () => {
    const db = database();
    try {
      let at = 10 * DAY;
      const port = createApartmentsPort([], async <T>(op: StorageRequest) => {
        if (op.type !== "apartments") throw new Error("unexpected request");
        at += 1;
        return writeApartments(db, op.operation, at) as T;
      });
      // Both start before either write: a list diff would hand Bob Alice's row.
      const [alice, bob] = await Promise.all([
        port.moveIn(resident("alice", at + 1)),
        port.moveIn(resident("bob", at + 2)),
      ]);
      expect([alice.name, bob.name]).toEqual(["alice", "bob"]);
      expect(alice.id).not.toBe(bob.id);
      await Promise.all([
        port.report(alice.id, "Report for alice"),
        port.report(bob.id, "Report for bob"),
      ]);
      expect(
        readApartments(db).map(({ name, last_report }) => [name, last_report]),
      ).toEqual([
        ["alice", "Report for alice"],
        ["bob", "Report for bob"],
      ]);
      const memory = memoryApartmentsPort([], () => at);
      const both = await Promise.all([
        memory.moveIn(resident("carol", at)),
        memory.moveIn(resident("dan", at)),
      ]);
      expect(both.map((item) => item.name)).toEqual(["carol", "dan"]);
    } finally {
      db.close();
    }
  });

  test("malformed residents are refused and text is bounded", () => {
    expect(() =>
      parseApartmentMoveIn({ ...resident("x", DAY), runtime: "other" }),
    ).toThrow(/runtime/);
    expect(() =>
      parseApartmentMoveIn({ ...resident("x", DAY), name: "  " }),
    ).toThrow(/name/);
    expect(() =>
      parseApartmentMoveIn({
        ...resident("x", DAY),
        links: [{ kind: "pr", number: 1, url: "javascript:alert(1)" }],
      }),
    ).toThrow(/url/);
    const long = parseApartmentMoveIn({
      ...resident("x", DAY),
      summary: `a\u0007b${"z".repeat(5000)}`,
    });
    expect(long.summary!.length).toBe(2000);
    expect(long.summary!.startsWith("a b")).toBe(true);
  });

  test("the memory port follows the same rules", async () => {
    const port = memoryApartmentsPort([], () => 50 * DAY, { capacity: 1 });
    await port.moveIn(resident("a", 49 * DAY));
    const b = await port.moveIn(resident("b", 50 * DAY));
    expect(port.list().map((row) => row.name)).toEqual(["b"]);
    await port.report(b.id, "Opened PR #42");
    expect(port.get(b.id)?.last_report).toBe("Opened PR #42");
    await port.evict([b.id]);
    expect(port.list()).toEqual([]);
  });

  test("the real storage worker keeps residents across a reopen", async () => {
    const paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: folder() });
    const options = { clock: systemClock, scheduler: systemScheduler };
    const first = await openStorage(paths, options);
    const moved = await first.apartments!.moveIn(resident("grace", Date.now()));
    await first.apartments!.report(moved.id, "Opened PR #42");
    const saved = first.apartments!.get(moved.id)!;
    expect(saved.last_report).toBe("Opened PR #42");
    await first.close();
    const second = await openStorage(paths, options);
    stores.push(second);
    expect(second.apartments!.list()).toEqual([saved]);
    await second.apartments!.evict([saved.id]);
    expect(second.apartments!.list()).toEqual([]);
  });
});
