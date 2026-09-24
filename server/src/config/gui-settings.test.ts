import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repoSettingsKey,
  workspaceAutoSyncSettingsKey,
  workspaceRepoSettingsKey,
} from "./gui-settings";

test("terminal codec preferences survive a fresh process and default to enabled", async () => {
  const home = await mkdtemp(join(tmpdir(), "roamgate-settings-"));
  const source = JSON.stringify(import.meta.resolve("./gui-settings"));
  const run = async (script: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { readGuiSettings, updateGuiSettings, terminalSurfaceCodecsEnabled } from ${source}; ${script}`,
      ],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          APPDATA: join(home, "AppData"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    return JSON.parse(stdout);
  };
  try {
    expect(
      await run(
        `const settings = await readGuiSettings(); console.log(JSON.stringify([terminalSurfaceCodecsEnabled(settings), terminalSurfaceCodecsEnabled(settings, "alpha")]));`,
      ),
    ).toEqual([true, true]);
    expect(
      await run(
        `await updateGuiSettings(s => ({ ...s, custom: { keep: "yes" }, terminal_transport: { "legacy-default": { surface_codecs: false }, alpha: { surface_codecs: false }, beta: { surface_codecs: true } } })); console.log("true");`,
      ),
    ).toBe(true);
    expect(
      await run(
        `const s = await readGuiSettings(); console.log(JSON.stringify([terminalSurfaceCodecsEnabled(s), terminalSurfaceCodecsEnabled(s, "alpha"), terminalSurfaceCodecsEnabled(s, "beta"), terminalSurfaceCodecsEnabled(s, "new"), s.custom.keep]));`,
      ),
    ).toEqual([false, false, true, true, "yes"]);
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
