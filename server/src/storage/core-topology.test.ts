import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CoreTopologyConflict,
  memoryCoreTopologyPort,
  parseCoreTopology,
  readCoreTopologies,
  writeCoreTopology,
} from "./core-topology";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function database() {
  const root = mkdtempSync(join(tmpdir(), "hcw-topo-"));
  roots.push(root);
  const path = join(root, "world.sqlite");
  const db = new Database(path);
  migrateWorldDatabase(db, path, worldMigrations, 0);
  return db;
}

const doc = (revision: number, label = "Review") => ({
  core_id: "c0ffee0000000001",
  revision,
  rooms: [
    {
      id: "main",
      label: "",
      tabs: [{ id: "b1", label: "Builder", terminals: ["t1"] }],
    },
    { id: "r1", label, tabs: [] },
    {
      id: "r2",
      label: "",
      app_space: "s1",
      tabs: [{ id: "b2", label: "Sh", terminals: ["t4"] }],
    },
  ],
});

describe("World's layout of a core lives in its SQLite (M1)", () => {
  test("written with compare-and-set and read back in order", () => {
    const db = database();
    expect(readCoreTopologies(db)).toEqual([]);
    expect(writeCoreTopology(db, 0, doc(0))).toMatchObject({ revision: 1 });
    expect(writeCoreTopology(db, 1, doc(1, "Renamed")).revision).toBe(2);
    expect(() => writeCoreTopology(db, 1, doc(1, "Stale"))).toThrow(
      CoreTopologyConflict,
    );
    const [saved] = readCoreTopologies(db);
    expect(saved).toEqual({ ...doc(2, "Renamed") });
    db.close();
  });

  test("a terminal is in one tab, IDs are unique, addresses are local", () => {
    const twice = doc(0);
    twice.rooms[1]!.tabs.push({ id: "b3", label: "x", terminals: ["t1"] });
    expect(() => parseCoreTopology(twice)).toThrow("terminal");
    const clash = doc(0);
    clash.rooms[1]!.id = "main";
    expect(() => parseCoreTopology(clash)).toThrow("room id");
    const remote = doc(0);
    remote.rooms[0]!.tabs[0]!.terminals = ["mac/t1"];
    expect(() => parseCoreTopology(remote)).toThrow("terminal");
    const space = doc(0);
    space.rooms[1]!.app_space = "s1";
    expect(() => parseCoreTopology(space)).toThrow("app space");
  });

  test("the port applies one change per core at a time", async () => {
    const port = memoryCoreTopologyPort();
    const core = "c0ffee0000000001";
    const add = (id: string) =>
      port.update(core, (current) => ({
        ...current,
        rooms: [...current.rooms, { id, label: id, tabs: [] }],
      }));
    await Promise.all([add("ra"), add("rb"), add("rc")]);
    expect(port.get(core)).toMatchObject({
      revision: 3,
      rooms: [{ id: "ra" }, { id: "rb" }, { id: "rc" }],
    });
    // A failed change leaves the next one free to run.
    await expect(
      port.update(core, () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    await add("rd");
    expect(port.get(core).revision).toBe(4);
    expect(port.get("another").rooms).toEqual([]);
  });
});
