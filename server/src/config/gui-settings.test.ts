import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "./data-paths";
import {
  createGuiSettingsStore,
  repoSettingsKey,
  terminalSurfaceCodecsEnabled,
  workspaceAutoSyncSettingsKey,
  workspaceRepoSettingsKey,
} from "./gui-settings";

test("terminal codec preferences survive a fresh store and default to enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "roamgate-settings-"));
  const path = join(root, "settings.json");
  try {
    const defaults = await createGuiSettingsStore(path).read();
    expect([
      terminalSurfaceCodecsEnabled(defaults),
      terminalSurfaceCodecsEnabled(defaults, "alpha"),
    ]).toEqual([true, true]);
    await createGuiSettingsStore(path).update((s) => ({
      ...s,
      custom: { keep: "yes" },
      terminal_transport: {
        "legacy-default": { surface_codecs: false },
        alpha: { surface_codecs: false },
        beta: { surface_codecs: true },
      },
    }));
    const s = await createGuiSettingsStore(path).read();
    expect([
      terminalSurfaceCodecsEnabled(s),
      terminalSurfaceCodecsEnabled(s, "alpha"),
      terminalSurfaceCodecsEnabled(s, "beta"),
      terminalSurfaceCodecsEnabled(s, "new"),
      s.custom.keep,
    ]).toEqual([false, false, true, true, "yes"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit settings paths isolate writes and bypass legacy migration", async () => {
  const home = await mkdtemp(join(tmpdir(), "roamgate-settings-override-"));
  const legacyPath = join(home, ".config", "herdr-gui", "settings.json");
  const defaultPath = join(home, ".config", "herdr-world", "settings.json");
  const overridePath = join(home, "isolated", "settings.json");
  const aliasPath = join(home, "alias", "settings.json");
  const legacySettings = JSON.stringify({
    version: 1,
    custom: { legacy: true },
  });
  const settingsPath = (current: string | undefined) =>
    resolveDataPaths(
      {
        HERDR_WORLD_SETTINGS_PATH: current,
        HERDR_GUI_SETTINGS_PATH: aliasPath,
      },
      home,
      "linux",
    ).settings;
  try {
    await mkdir(join(home, ".config", "herdr-gui"), { recursive: true });
    await writeFile(legacyPath, legacySettings);
    const store = createGuiSettingsStore(settingsPath(overridePath));
    const before = await store.read();
    await store.update((s) => ({ ...s, custom: { isolated: true } }));
    expect([store.path, before.custom]).toEqual([overridePath, {}]);
    expect(JSON.parse(await readFile(overridePath, "utf8")).custom).toEqual({
      isolated: true,
    });
    expect(await readFile(legacyPath, "utf8")).toBe(legacySettings);
    expect(await Bun.file(defaultPath).exists()).toBe(false);
    expect(await Bun.file(aliasPath).exists()).toBe(false);
    expect(settingsPath(undefined)).toBe(defaultPath);
    expect(settingsPath("")).toBe("");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("settings keys preserve legacy format and isolate connection identities", () => {
  const workspace = {
    worktree: {
      repo_key: "same-repo",
      checkout_path: "/same/checkout",
    },
  };

  expect(repoSettingsKey("same-repo")).toBe("local:same-repo");
  expect(repoSettingsKey("same-repo", undefined, "startup-default")).toBe(
    "local:same-repo",
  );
  expect(repoSettingsKey("same-repo", "same-host", "startup-default")).toBe(
    "ssh:same-host:same-repo",
  );

  expect(workspaceRepoSettingsKey(workspace, undefined, "alpha")).toBe(
    "connection:alpha:local:same-repo",
  );
  expect(workspaceRepoSettingsKey(workspace, undefined, "beta")).toBe(
    "connection:beta:local:same-repo",
  );
  expect(
    workspaceAutoSyncSettingsKey("/same/checkout", "same-host", "alpha"),
  ).toBe("connection:alpha:ssh:same-host:/same/checkout");
  expect(
    workspaceAutoSyncSettingsKey("/same/checkout", "same-host", "beta"),
  ).toBe("connection:beta:ssh:same-host:/same/checkout");
  expect(repoSettingsKey("same", undefined, "alpha:local:beta")).toBe(
    "connection:alpha%3Alocal%3Abeta:local:same",
  );
});
