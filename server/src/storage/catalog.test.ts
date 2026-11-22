import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openPrivateDurableStorage } from "../assistant/durable-storage";
import { openTaskStorage } from "../assistant/task-storage";
import { validateSavedTasks } from "../assistant/tasks";
import { migrateWorldDatabase } from "./world-schema";
import { dataPathCatalog, declareData, storageCatalog } from "./catalog";
import { resolveDataPaths } from "../config/data-paths";
import {
  browserKeys,
  memorySources,
} from "../../../scripts/storage-catalog-sources";
import {
  catalogNotes,
  updateCatalogNotes,
} from "../../../scripts/storage-catalog";

const locations = (store: string) =>
  storageCatalog
    .filter((entry) => entry.store === store)
    .flatMap((entry) => entry.locations);
const tables = (db: Database) =>
  (
    db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
const match = (pattern: string, key: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(key);

test("every migrated World table and every Ranger table has exactly one catalog home", async () => {
  const db = new Database(":memory:");
  try {
    migrateWorldDatabase(db, ":memory:", undefined, 1000);
    expect(locations("world.sqlite").sort()).toEqual(tables(db));
  } finally {
    db.close();
  }
  const root = mkdtempSync(join(tmpdir(), "catalog-"));
  try {
    const tasks = openTaskStorage(root, validateSavedTasks);
    tasks.close();
    const taskDb = new Database(join(root, "tasks.sqlite"), { readonly: true });
    try {
      expect(locations("assistant/tasks.sqlite").sort()).toEqual(
        tables(taskDb),
      );
    } finally {
      taskDb.close();
    }
    const id = randomUUID();
    const durable = await openPrivateDurableStorage(
      root,
      id,
      BACKGROUND_CONTEXT,
    );
    await durable.release();
    const execution = new Database(
      join(root, "durable", id, "execution.sqlite"),
      { readonly: true },
    );
    try {
      expect(locations("assistant/execution.sqlite").sort()).toEqual(
        tables(execution),
      );
    } finally {
      execution.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every DataPaths property points to a cataloged file family", () => {
  expect(Object.keys(dataPathCatalog).sort()).toEqual(
    Object.keys(resolveDataPaths({})).sort(),
  );
  for (const location of Object.values(dataPathCatalog))
    expect(locations("file").filter((name) => name === location)).toHaveLength(
      1,
    );
});

test("browserStorage consumers have exactly one home per discovered key family", () => {
  const unresolved: string[] = [];
  const keys = browserKeys(undefined, unresolved);
  expect(unresolved).toEqual([]);
  expect(keys.length).toBeGreaterThan(70);
  for (const key of keys)
    expect(
      locations("browser").filter((pattern) => match(pattern, key)),
      key,
    ).toHaveLength(1);
  for (const pattern of locations("browser")) {
    if (pattern === "update-notifications/versions") continue; // IndexedDB, not Storage.
    expect(
      keys.some((key) => match(pattern, key)),
      pattern,
    ).toBe(true);
  }
}, 20_000);

test("stateful domain classes and named functional stores are cataloged", () => {
  const memory = locations("memory");
  for (const owner of memorySources())
    expect(
      memory.filter((name) => name === owner),
      owner,
    ).toHaveLength(1);
  for (const owner of memory) {
    const [path, name] = owner.split("#");
    expect(readFileSync(path!, "utf8").includes(name!), owner).toBe(true);
  }
});

test("catalog metadata is complete, unique and refers to existing owning code", () => {
  const identities = new Set<string>();
  for (const entry of storageCatalog) {
    expect(["source", "cache", "derived"]).toContain(entry.role);
    for (const value of [
      entry.meaning,
      entry.feature,
      entry.identity,
      entry.role,
      entry.limit,
      entry.code,
    ])
      expect(value.trim().length).toBeGreaterThan(0);
    for (const path of entry.code.split(" "))
      expect(existsSync(path), path).toBe(true);
    for (const location of entry.locations) {
      const id = `${entry.store}:${location}`;
      expect(identities.has(id), id).toBe(false);
      identities.add(id);
    }
  }
  const notes = readFileSync(catalogNotes, "utf8");
  expect(notes).toBe(updateCatalogNotes(notes));
});

test("declareData is an inert feature declaration seam", () => {
  const declaration = {
    feature: "fixture",
    name: "fixture",
    kind: "fact" as const,
    validate: (body: unknown) => body,
    limit: null,
    lifetime: "native" as const,
    syncScope: ["town"],
  };
  expect(declareData(declaration)).toBe(declaration);
});

test("browser discovery follows new imported, helper and scoped keys and flags unknown builders", () => {
  const root = mkdtempSync(join(tmpdir(), "catalog-keys-"));
  try {
    const constants = join(root, "keys.ts"),
      consumer = join(root, "consumer.ts");
    writeFileSync(constants, 'export const KEY = "synthetic.imported";');
    writeFileSync(
      consumer,
      `
      import { KEY as imported } from "./keys";
      const storage = window.localStorage;
      const read = (key: string) => storage.getItem(key);
      read(imported);
      function one() { const key = "synthetic.one"; storage.setItem(key, "1"); }
      function two() { const key = "synthetic.two"; storage.removeItem(key); }
      const scoped = (id: string) => \`synthetic.scope:\${id}\`;
      storage.getItem(scoped(window.name));
      storage.getItem(unknownBuilder());
      class SyntheticMemory { values = new Map(); }
      export function createSyntheticStore() { const values = new Map(); return { values }; }
    `,
    );
    const unresolved: string[] = [];
    const keys = browserKeys([constants, consumer], unresolved);
    expect(keys).toEqual([
      "synthetic.imported",
      "synthetic.one",
      "synthetic.scope:*",
      "synthetic.two",
    ]);
    expect(unresolved).toHaveLength(1);
    const memory = memorySources([consumer]);
    expect(memory).toEqual([
      `${consumer}#SyntheticMemory`,
      `${consumer}#createSyntheticStore`,
    ]);
    for (const owner of memory)
      expect(locations("memory").includes(owner)).toBe(false);
    for (const key of keys)
      expect(locations("browser").some((pattern) => match(pattern, key))).toBe(
        false,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
