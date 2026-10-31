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
import { resolveDataPaths } from "../config/data-paths";
import { openStorage, type WorldStorage } from "./storage";
import { systemClock, systemScheduler } from "./ports";
const roots: string[] = [],
  stores: WorldStorage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-status-"));
  roots.push(root);
  return resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
};
const open = async (paths: ReturnType<typeof fresh>) => {
  const store = await openStorage(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  stores.push(store);
  return store;
};
const key = "connection:studio:local:/synthetic/repo";
const status = {
  last_run_at: "2026-10-01T01:00:00.000Z",
  last_status: "updated" as const,
  last_message: "Synthetic merge completed",
  last_branch: "feature/synthetic",
};
const config = (entry: object) => ({
  version: 1,
  title_suffix: "Synthetic World",
  repositories: {},
  custom: { feature: { enabled: true } },
  workspace_auto_sync: {
    [key]: {
      enabled: true,
      interval_minutes: 10,
      checkout_path: "/synthetic/repo",
      ...entry,
    },
  },
});

test("the root imports only runtime status once after an exact backup and keeps configuration in files", async () => {
  const paths = fresh(),
    source = JSON.stringify(config(status));
  writeFileSync(paths.settings, source, { mode: 0o600 });
  const backup = `${paths.settings}.${createHash("sha256").update(source).digest("hex")}.runtime-status-import.bak`;
  const store = await open(paths);
  expect(existsSync(backup)).toBe(true);
  expect(readFileSync(backup, "utf8")).toBe(source);
  expect(store.runtimeStatus.get(key)).toEqual(status);
  const settings = await store.settings.read();
  expect(settings.workspace_auto_sync[key]).not.toHaveProperty("last_run_at");
  expect(settings.custom).toEqual({ feature: { enabled: true } });
  const next = {
    ...status,
    last_status: "failed" as const,
    last_message: "Synthetic failure",
  };
  const pending = store.runtimeStatus.put(key, next);
  expect(store.runtimeStatus.get(key)).toEqual(status);
  await pending;
  expect(readFileSync(paths.settings, "utf8")).toBe(source);
  await store.settings.update((s) => ({ ...s, title_suffix: "Changed World" }));
  const disk = JSON.parse(readFileSync(paths.settings, "utf8"));
  expect(disk.workspace_auto_sync[key]).toEqual({
    enabled: true,
    interval_minutes: 10,
    checkout_path: "/synthetic/repo",
  });
  expect(disk.custom).toEqual(settings.custom);
  await store.close();
  const db = new Database(join(paths.root, "world.sqlite"), { readonly: true });
  const marker = db
    .query("SELECT * FROM imports WHERE name='runtime-status-json'")
    .get();
  db.close();
  writeFileSync(
    paths.settings,
    JSON.stringify(
      config({ ...status, last_message: "Stale retained status" }),
    ),
  );
  const again = await open(paths);
  expect(again.runtimeStatus.get(key)).toEqual(next);
  await again.close();
  const inspected = new Database(join(paths.root, "world.sqlite"), {
    readonly: true,
  });
  try {
    expect(
      inspected
        .query("SELECT * FROM imports WHERE name='runtime-status-json'")
        .get(),
    ).toEqual(marker);
  } finally {
    inspected.close();
  }
});

test("runtime rows isolate qualified keys, drain admitted writes, and retain only committed cached reads after close", async () => {
  const paths = fresh(),
    store = await open(paths),
    other = "connection:other:local:/synthetic/repo";
  const writes = Array.from({ length: 33 }, (_, index) =>
    store.runtimeStatus.put(index % 2 ? other : key, {
      ...status,
      last_message: `Synthetic ${index}`,
    }),
  );
  const closing = store.close();
  await Promise.all(writes);
  await closing;
  expect(store.runtimeStatus.get(key)?.last_message).toBe("Synthetic 32");
  expect(store.runtimeStatus.get(other)?.last_message).toBe("Synthetic 31");
  const before = readFileSync(join(paths.root, "world.sqlite"));
  await expect(store.runtimeStatus.put(key, status)).rejects.toThrow(/clos/);
  expect(readFileSync(join(paths.root, "world.sqlite"))).toEqual(before);
  const reopened = await open(paths);
  expect(reopened.runtimeStatus.list()).toEqual(store.runtimeStatus.list());
});

test("an invalid initial settings import releases the worker and retries without partial runtime rows", async () => {
  const paths = fresh(),
    source = "{ invalid initial settings";
  writeFileSync(paths.settings, source, { mode: 0o600 });
  await expect(
    openStorage(paths, { clock: systemClock, scheduler: systemScheduler }),
  ).rejects.toThrow();
  const backup = `${paths.settings}.${createHash("sha256").update(source).digest("hex")}.runtime-status-import.bak`;
  expect(readFileSync(backup, "utf8")).toBe(source);
  expect(readFileSync(paths.settings, "utf8")).toBe(source);
  const db = new Database(join(paths.root, "world.sqlite"));
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
  writeFileSync(paths.settings, JSON.stringify(config(status)));
  const repaired = await open(paths);
  expect(repaired.runtimeStatus.get(key)).toEqual(status);
});
