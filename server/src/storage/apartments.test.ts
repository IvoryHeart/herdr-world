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
  session_id: `session-${name}`,
  appearance: null,
  ...extra,
});
const found = (
  name: string,
  movedOut: number,
  extra: Partial<ApartmentMoveIn> = {},
) =>
  resident(name, movedOut, {
    move_out: "found",
    room: null,
    tab: null,
    links: [],
    terminal_id: `session:session-${name}`,
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

  test("capacity moves out the oldest, at any age; evict removes by ID", () => {
    const db = database();
    try {
      const bounds = { capacity: 2 };
      const at = 4000 * DAY;
      for (const [name, day] of [
        ["ancient", -3000],
        ["a", 1],
        ["b", 2],
      ] as const)
        writeApartments(
          db,
          { type: "move-in", resident: resident(name, at + day * DAY) },
          at,
          bounds,
        );
      expect(readApartments(db).map((row) => row.name)).toEqual(["a", "b"]);
      writeApartments(
        db,
        { type: "move-in", resident: resident("c", at + 3 * DAY) },
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

  test("one session is one resident: found, ended again, evicted for good", () => {
    const db = database();
    try {
      const at = 100 * DAY;
      const write = (operation: Parameters<typeof writeApartments>[1]) =>
        writeApartments(db, operation, at).residents;
      // Found in a history: asleep, once, however often it is found.
      write({ type: "found", residents: [found("ada", at - 5 * DAY)] });
      write({ type: "found", residents: [found("ada", at - 5 * DAY)] });
      expect(readApartments(db).map((row) => row.move_out)).toEqual(["found"]);
      // Its transcript was written since: the record follows, summary kept.
      write({
        type: "found",
        residents: [found("ada", at - DAY, { summary: "Another summary" })],
      });
      expect(readApartments(db)).toMatchObject([
        { moved_out_at: at - DAY, summary: "Synthetic summary for ada" },
      ]);
      // Resumed at a desk and ended there: the seen end replaces it.
      write({ type: "move-in", resident: resident("ada", at) });
      expect(readApartments(db)).toMatchObject([
        { move_out: "ended", moved_out_at: at },
      ]);
      // A history never overwrites a seen end.
      write({ type: "found", residents: [found("ada", at + DAY)] });
      expect(readApartments(db)).toMatchObject([{ move_out: "ended" }]);
      // Evicted: the next census does not bring it back.
      const id = readApartments(db)[0]!.id;
      write({ type: "evict", ids: [id] });
      write({ type: "found", residents: [found("ada", at + 2 * DAY)] });
      expect(readApartments(db)).toEqual([]);
      // Unless it runs again and its end is seen.
      write({ type: "move-in", resident: resident("ada", at + 3 * DAY) });
      write({ type: "evict", ids: [] });
      expect(readApartments(db)).toHaveLength(1);
      // Found records without a session, or not marked found, are refused.
      write({
        type: "found",
        residents: [
          found("nobody", at, { session_id: null }),
          found("seen", at, { move_out: "ended" }),
        ],
      });
      expect(readApartments(db).map((row) => row.name)).toEqual(["ada"]);
    } finally {
      db.close();
    }
  });

  test("a resident keeps its usage agent IDs, bounded, across a resumed run", async () => {
    const at = 100 * DAY;
    const a = (n: number) => `agent_${String(n).padStart(64, "0")}`;
    // Old records have none; bad entries are dropped; the newest 8 are kept.
    expect(parseApartmentMoveIn(resident("old", at)).usage_agent_ids).toEqual(
      [],
    );
    expect(
      parseApartmentMoveIn(
        resident("bad", at, {
          usage_agent_ids: [a(1), 7, "", "x".repeat(101), a(1), a(2)] as never,
        }),
      ).usage_agent_ids,
    ).toEqual([a(1), a(2)]);
    expect(
      parseApartmentMoveIn(
        resident("many", at, {
          usage_agent_ids: Array.from({ length: 12 }, (_, i) => a(i)),
        }),
      ).usage_agent_ids,
    ).toEqual(Array.from({ length: 8 }, (_, i) => a(i + 4)));
    // Resumed and ended again: one resident, counted under both runs.
    const db = database();
    try {
      const write = (operation: Parameters<typeof writeApartments>[1]) =>
        writeApartments(db, operation, at);
      write({
        type: "move-in",
        resident: resident("ada", at - DAY, { usage_agent_ids: [a(1)] }),
      });
      write({
        type: "move-in",
        resident: resident("ada", at, { usage_agent_ids: [a(2)] }),
      });
      expect(readApartments(db)).toMatchObject([
        { name: "ada", usage_agent_ids: [a(1), a(2)] },
      ]);
    } finally {
      db.close();
    }
    // A found record's later refresh keeps the usage World counted for it.
    const found2 = database();
    try {
      writeApartments(
        found2,
        {
          type: "found",
          residents: [found("bo", at - DAY, { usage_agent_ids: [a(3)] })],
        },
        at,
      );
      writeApartments(
        found2,
        { type: "found", residents: [found("bo", at)] },
        at,
      );
      expect(readApartments(found2)).toMatchObject([
        { name: "bo", moved_out_at: at, usage_agent_ids: [a(3)] },
      ]);
    } finally {
      found2.close();
    }
    const port = memoryApartmentsPort([], () => at);
    await port.found([found("bo", at - DAY, { usage_agent_ids: [a(3)] })]);
    await port.found([found("bo", at)]);
    expect(port.list().map((row) => row.usage_agent_ids)).toEqual([[a(3)]]);
    await port.evict(port.list().map((row) => row.id));
    await port.moveIn(resident("ada", at - DAY, { usage_agent_ids: [a(1)] }));
    await port.moveIn(resident("ada", at, { usage_agent_ids: [a(2)] }));
    expect(port.list().map((row) => row.usage_agent_ids)).toEqual([
      [a(1), a(2)],
    ]);
  });

  test("an older database gains session keys for the residents it has", () => {
    const path = join(folder(), "world.sqlite");
    const db = new Database(path);
    try {
      const before = worldMigrations.findIndex(
        (sql) =>
          typeof sql === "string" && sql.includes("ADD COLUMN session_key"),
      );
      expect(before).toBeGreaterThan(0);
      migrateWorldDatabase(db, path, worldMigrations.slice(0, before), 0);
      const old = resident("grace", 10 * DAY, { harness: "codex" });
      db.query("INSERT INTO apartment_residents VALUES(?,?,?)").run(
        "r-old",
        old.moved_out_at,
        JSON.stringify(old),
      );
      migrateWorldDatabase(db, path, worldMigrations, 0);
      writeApartments(
        db,
        {
          type: "found",
          residents: [found("grace", 20 * DAY, { harness: "codex" })],
        },
        20 * DAY,
      );
      expect(readApartments(db)).toMatchObject([
        { id: "r-old", move_out: "ended" },
      ]);
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
    const port = memoryApartmentsPort([], () => 50 * DAY, { capacity: 2 });
    await port.found([found("z", 40 * DAY)]);
    expect([...port.sessionKeys()]).toEqual(["claude/session-z"]);
    await port.moveIn(resident("a", 49 * DAY));
    await port.evict([port.list()[1]!.id]);
    await port.found([found("a", 49 * DAY)]);
    expect(port.list().map((row) => row.name)).toEqual(["z"]);
    const b = await port.moveIn(resident("b", 50 * DAY));
    await port.found([found("y", 45 * DAY)]);
    expect(port.list().map((row) => row.name)).toEqual(["y", "b"]);
    await port.report(b.id, "Opened PR #42");
    expect(port.get(b.id)?.last_report).toBe("Opened PR #42");
    await port.evict([b.id]);
    expect(port.list().map((row) => row.name)).toEqual(["y"]);
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
