import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeConnectionProfiles } from "./first-run";
import { ConnectionProfileStore } from "./profiles";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test.each(["before", "after"])(
  "discovery save failure %s publication retries from persisted authority",
  async (boundary) => {
    const args = fixture();
    const save = args.store.save.bind(args.store);
    let calls = 0;
    args.store.save = async (registry) => {
      calls++;
      if (boundary === "after") await save(registry);
      throw new Error("synthetic interrupted startup");
    };
    await expect(initializeConnectionProfiles(args)).rejects.toThrow(
      "synthetic interrupted startup",
    );
    expect(args.store.load() === null).toBe(boundary === "before");
    args.store.save = save;
    const retried = await initializeConnectionProfiles(args);
    expect(retried.defaultConnectionId).toBe("core-local");
    expect(args.store.load()).toEqual(retried.persistedRegistry);
    expect(await initializeConnectionProfiles(args)).toEqual(retried);
    expect(calls).toBe(1);
  },
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-first-run-"));
  roots.push(root);
  const state = join(root, "state", "herdr-core", "example-session");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "core.lock"), join(root, "core.sock"));
  return {
    store: new ConnectionProfileStore({
      path: join(root, "private", "connections.json"),
    }),
    startupProfile: {
      id: "startup-default" as const,
      label: "Default",
      type: "local" as const,
      control_socket_path: join(root, "tui.sock"),
      client_socket_path: join(root, "tui-client.sock"),
      auto_connect: true,
    },
    explicitStartupOverride: false,
    discovery: {
      homeDir: root,
      env: {
        PATH: "",
        XDG_STATE_HOME: join(root, "state"),
        HC_SESSION: "example-session",
      },
    },
  };
}

test("fresh core-only state selects and saves core with no dead TUI profile", async () => {
  const args = fixture();
  const bootstrap = await initializeConnectionProfiles(args);
  expect(bootstrap.defaultConnectionId).toBe("core-local");
  expect(bootstrap.registrations).toEqual([
    {
      readOnly: false,
      profile: {
        id: "core-local",
        label: "herdr-core on this computer",
        type: "local",
        runtime: "herdr-core",
        core_session: "example-session",
        core_state_dir: "",
        auto_connect: true,
      },
    },
  ]);
  expect(args.store.load()).toEqual(bootstrap.persistedRegistry);
  expect(existsSync(args.startupProfile.control_socket_path)).toBeFalse();
  expect(await initializeConnectionProfiles(args)).toEqual(bootstrap);
});

test("saved default and disabled auto-connect survive local core discovery", async () => {
  const args = fixture();
  const saved = {
    version: 2 as const,
    default_connection_id: "chosen",
    profiles: [
      {
        ...args.startupProfile,
        id: "chosen",
        auto_connect: false,
      },
    ],
  };
  await args.store.save(saved);
  expect((await initializeConnectionProfiles(args)).defaultConnectionId).toBe(
    "chosen",
  );
  expect(args.store.load()).toEqual(saved);
});

test("explicit startup overrides suppress discovery without saving profiles", async () => {
  const args = fixture();
  const bootstrap = await initializeConnectionProfiles({
    ...args,
    explicitStartupOverride: true,
  });
  expect(bootstrap.defaultConnectionId).toBe("startup-default");
  expect(bootstrap.explicitStartupOverride).toBeTrue();
  expect(args.store.load()).toBeNull();
});

test("an installed local TUI keeps the existing first-run behavior", async () => {
  const args = fixture();
  const bin = join(args.discovery.homeDir, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, process.platform === "win32" ? "herdr.exe" : "herdr"),
    "synthetic binary presence",
  );
  const bootstrap = await initializeConnectionProfiles(args);
  expect(bootstrap.registrations).toEqual([
    { profile: args.startupProfile, readOnly: true },
  ]);
  expect(args.store.load()).toBeNull();
});

test("a stale TUI endpoint without an installed TUI does not hide core", async () => {
  const args = fixture();
  writeFileSync(args.startupProfile.control_socket_path, "stale TUI presence");
  expect((await initializeConnectionProfiles(args)).defaultConnectionId).toBe(
    "core-local",
  );
});

test("invalid saved state is preserved instead of being replaced by discovery", async () => {
  const args = fixture();
  mkdirSync(join(args.discovery.homeDir, "private"), { mode: 0o700 });
  writeFileSync(args.store.path, "invalid JSON", { mode: 0o600 });
  await expect(initializeConnectionProfiles(args)).rejects.toThrow(
    "not valid JSON",
  );
  expect(readFileSync(args.store.path, "utf8")).toBe("invalid JSON");
});

for (const platform of ["darwin", "linux"] as const) {
  test(`${platform}: an installed core without a lock is discovered off PATH`, async () => {
    const args = fixture();
    rmSync(args.discovery.env.XDG_STATE_HOME, { recursive: true });
    const bin = join(args.discovery.homeDir, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "herdr-core"), "synthetic binary presence");
    const bootstrap = await initializeConnectionProfiles({
      ...args,
      discovery: { ...args.discovery, platform },
    });
    expect(bootstrap.defaultConnectionId).toBe("core-local");
  });
}

test("no runtime keeps the existing setup path and creates no registry", async () => {
  const args = fixture();
  rmSync(args.discovery.env.XDG_STATE_HOME, { recursive: true });
  expect((await initializeConnectionProfiles(args)).defaultConnectionId).toBe(
    "startup-default",
  );
  expect(args.store.load()).toBeNull();
});
