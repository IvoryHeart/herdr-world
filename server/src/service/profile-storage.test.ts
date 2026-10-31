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
import { ProfileStore } from "../agent/profile-store";
import { TerminalSettings } from "../agent/terminal-settings";
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
  const root = mkdtempSync(join(tmpdir(), "sqlite-profiles-"));
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

test("the real storage port backs up and imports profile JSON once, then uses SQLite exclusively", async () => {
  const paths = fresh();
  const document = {
    ...new ProfileStore(paths.agentProfiles).get(),
    revision: 7,
    assignments: [
      {
        connection_id: "studio",
        terminal_id: "terminal-a",
        profile_id: "builder",
      },
    ],
    terminal_settings: {
      imported_connections: ["earlier-host"],
      highest_master_revision: 123,
    },
  };
  const legacy = JSON.stringify(document);
  writeFileSync(paths.agentProfiles, legacy, { mode: 0o600 });
  const backup = `${paths.agentProfiles}.${createHash("sha256").update(legacy).digest("hex")}.sqlite-import.bak`;
  const store = await open(paths);
  expect(existsSync(backup)).toBe(true);
  expect(readFileSync(backup, "utf8")).toBe(legacy);
  expect(store.profiles().get()).toEqual(document);
  const saved = await store.profiles().save({
    ...store.profiles().profile("builder")!,
    name: "Synthetic builder",
  });
  expect(readFileSync(paths.agentProfiles, "utf8")).toBe(legacy);
  const cache = store.profiles();
  await store.close();
  const inspected = new Database(join(paths.root, "world.sqlite"), {
    readonly: true,
  });
  const imported = inspected
    .query("SELECT * FROM imports WHERE name='agent-profiles-json'")
    .get();
  inspected.close();
  // A retained source is never a second writer, even if edited after migration.
  writeFileSync(
    paths.agentProfiles,
    JSON.stringify({ ...document, profiles: [], revision: 999 }),
  );
  expect(cache.get()).toEqual(saved);
  const again = await open(paths);
  expect(again.profiles().get()).toEqual(saved);
  await again.close();
  const db = new Database(join(paths.root, "world.sqlite"), { readonly: true });
  try {
    expect(
      db.query("SELECT count(*) AS count FROM agent_profiles").get(),
    ).toEqual({ count: 4 });
    expect(
      db.query("SELECT * FROM imports WHERE name='agent-profiles-json'").get(),
    ).toEqual(imported);
    expect(
      db
        .query(
          "SELECT content_hash FROM imports WHERE name='agent-profiles-json'",
        )
        .get(),
    ).toEqual({
      content_hash: createHash("sha256").update(legacy).digest("hex"),
    });
  } finally {
    db.close();
  }
});

test("profile edits expose committed reads only and concurrent domain edits retain each other", async () => {
  const store = await open(fresh()),
    profiles = store.profiles();
  const before = profiles.get();
  const save = profiles.save({
    ...profiles.profile("builder")!,
    role: "Synthetic role",
  });
  expect(profiles.get()).toEqual(before);
  const first = await save;
  expect(first.revision).toBe(before.revision + 1);
  const operations = await Promise.all([
    profiles.save({
      ...profiles.profile("builder")!,
      name: "Synthetic builder",
    }),
    profiles.save({
      ...profiles.profile("reviewer")!,
      name: "Synthetic reviewer",
    }),
    profiles.saveChimes({
      ...profiles.get().chimes,
      motifs: { needs_you: true, for_you: false, finished: true },
    }),
  ]);
  expect(profiles.get().revision).toBe(before.revision + 4);
  expect(profiles.profile("builder")?.name).toBe("Synthetic builder");
  expect(profiles.profile("reviewer")?.name).toBe("Synthetic reviewer");
  expect(profiles.get().chimes.motifs.for_you).toBe(false);
  expect(new Set(operations.map((document) => document.revision)).size).toBe(3);
});

test("malformed initial JSON and conflicting backups fail closed and can be repaired without partial import", async () => {
  const paths = fresh();
  const malformed = "{ invalid profile JSON";
  writeFileSync(paths.agentProfiles, malformed, { mode: 0o600 });
  await expect(
    openStorage(paths, { clock: systemClock, scheduler: systemScheduler }),
  ).rejects.toThrow();
  expect(readFileSync(paths.agentProfiles, "utf8")).toBe(malformed);
  const malformedBackup = `${paths.agentProfiles}.${createHash("sha256").update(malformed).digest("hex")}.sqlite-import.bak`;
  expect(readFileSync(malformedBackup, "utf8")).toBe(malformed);
  const valid = JSON.stringify(
    new ProfileStore(join(paths.root, "synthetic-fixture.json")).get(),
  );
  writeFileSync(paths.agentProfiles, valid);
  const validBackup = `${paths.agentProfiles}.${createHash("sha256").update(valid).digest("hex")}.sqlite-import.bak`;
  writeFileSync(validBackup, "A different preserved backup", { mode: 0o600 });
  await expect(
    openStorage(paths, { clock: systemClock, scheduler: systemScheduler }),
  ).rejects.toThrow(/backup differs/);
  expect(readFileSync(validBackup, "utf8")).toBe(
    "A different preserved backup",
  );
  const db = new Database(join(paths.root, "world.sqlite"));
  try {
    expect(
      db.query("SELECT count(*) AS count FROM profile_store_meta").get(),
    ).toEqual({ count: 0 });
    expect(
      db.query("SELECT count(*) AS count FROM agent_profiles").get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query(
          "SELECT count(*) AS count FROM imports WHERE name='agent-profiles-json'",
        )
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }
  rmSync(validBackup);
  expect((await open(paths)).profiles().get().profiles).toHaveLength(4);
});

test("failed domain edits roll back independently while master revisions allocate atomically and survive restart", async () => {
  const paths = fresh(),
    store = await open(paths),
    profiles = store.profiles();
  const builder = profiles.profile("builder")!,
    before = profiles.get().revision;
  const refused = profiles.save({
    ...builder,
    chime: profiles.get().chimes.timbres.town_master,
  });
  const accepted = profiles.save({
    ...profiles.profile("reviewer")!,
    role: "Synthetic review role",
  });
  const outcomes = await Promise.allSettled([refused, accepted]);
  expect(outcomes[0]).toMatchObject({
    status: "rejected",
    reason: {
      message: expect.stringContaining("Town master's chime"),
      outcome: "not-committed",
    },
  });
  expect(outcomes[1]!.status).toBe("fulfilled");
  expect(profiles.profile("builder")).toEqual(builder);
  expect(profiles.get().revision).toBe(before + 1);
  const revisions = await Promise.all(
    Array.from({ length: 12 }, () => profiles.nextMasterRevision(100)),
  );
  expect(revisions).toEqual(
    Array.from({ length: 12 }, (_, index) => 100 + index),
  );
  await profiles.rememberMaster(1000);
  await profiles.rememberMaster(999);
  await store.close();
  const reopened = await open(paths);
  expect(await reopened.profiles().nextMasterRevision(100)).toBe(1001);
  expect(reopened.profiles().profile("reviewer")?.role).toBe(
    "Synthetic review role",
  );
});

test("a lease retired while its watermark commits cannot receive terminal metadata", async () => {
  const store = await open(fresh());
  const profiles = store.profiles();
  let current = true,
    writes = 0;
  const allocated = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>();
  const facade = {
    ...profiles,
    nextMasterRevision: async (minimum: number) => {
      const revision = await profiles.nextMasterRevision(minimum);
      allocated.resolve();
      await released.promise;
      return revision;
    },
  };
  const settings = new TerminalSettings(
    facade,
    () => ({
      generation: 1,
      isCurrent: () => current,
      runtime: {
        herdr: {
          call: async (method: string) => {
            if (method === "pane.get")
              return {
                pane: {
                  pane_id: "pane-a",
                  terminal_id: "terminal-a",
                  tokens: {},
                },
              };
            if (method === "pane.report_metadata") {
              writes++;
              return {};
            }
            throw new Error(`unexpected ${method}`);
          },
        },
      },
    }),
    () => {},
    () => 100,
  );
  const pending = settings.setMaster({
    terminal: {
      connection_id: "studio",
      connection_generation: 1,
      pane_id: "pane-a",
      terminal_id: "terminal-a",
    },
  });
  await allocated.promise;
  current = false;
  released.resolve();
  await expect(pending).rejects.toThrow(/runtime changed/);
  expect(writes).toBe(0);
  expect(profiles.settingsState().highest_master_revision).toBe(100);
});

test("terminal settings import their SQLite legacy records once and never restore a cleared live choice", async () => {
  const paths = fresh();
  const legacy = {
    ...new ProfileStore(join(paths.root, "synthetic-fixture.json")).get(),
    assignments: [
      {
        connection_id: "studio",
        terminal_id: "terminal-a",
        profile_id: "builder",
      },
    ],
  };
  writeFileSync(paths.agentProfiles, JSON.stringify(legacy), { mode: 0o600 });
  let tokens: Record<string, unknown> = {},
    writes = 0;
  const lease = () => ({
    generation: 1,
    isCurrent: () => true,
    runtime: {
      herdr: {
        call: async (method: string, params: Record<string, unknown>) => {
          if (method === "pane.get")
            return {
              pane: {
                pane_id: "pane-a",
                terminal_id: "terminal-a",
                tokens: { ...tokens },
              },
            };
          if (method === "pane.report_metadata") {
            writes++;
            tokens = { ...tokens, ...(params.tokens as object) };
            return {};
          }
          throw new Error(`unexpected ${method}`);
        },
      },
    },
  });
  const store = await open(paths),
    settings = new TerminalSettings(store.profiles(), lease);
  await settings.observe("studio", 1, [
    { pane_id: "pane-a", terminal_id: "terminal-a", tokens: {} },
  ]);
  expect(settings.get().assignments).toMatchObject([{ profile_id: "builder" }]);
  expect(store.profiles().settingsState().imported_connections).toEqual([
    "studio",
  ]);
  expect(writes).toBe(1);
  await store.close();
  // The terminal still exists; its owner deliberately cleared this choice.
  tokens = {};
  const reopened = await open(paths),
    after = new TerminalSettings(reopened.profiles(), lease);
  await after.observe("studio", 1, [
    { pane_id: "pane-a", terminal_id: "terminal-a", tokens: {} },
  ]);
  expect(after.get().assignments).toEqual([]);
  expect(writes).toBe(1);
});
