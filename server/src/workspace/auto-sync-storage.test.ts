import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage } from "../service/storage";
import { resolveDataPaths } from "../config/data-paths";
import { systemClock, systemScheduler } from "../service/ports";
import { createSettingsRpcHandler } from "../bridge/settings-rpc";
import { createWorkspaceAutoSync } from "./auto-sync";
import { shQuote } from "../utils/process-utils";

test("the real scheduler and RPC use durable status while toggles remain independent file configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "auto-sync-storage-")),
    paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
  const key = "connection:studio:local:/synthetic/repo",
    other = "connection:other:local:/synthetic/repo";
  writeFileSync(
    paths.settings,
    JSON.stringify({
      version: 1,
      workspace_auto_sync: {
        [key]: {
          enabled: true,
          interval_minutes: 10,
          checkout_path: "/synthetic/repo",
          last_run_at: "2999-01-01T00:00:00.000Z",
          last_status: "updated",
        },
        [other]: { enabled: true, interval_minutes: 10, last_status: "failed" },
      },
    }),
    { mode: 0o600 },
  );
  let store = await openStorage(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  let syncCalls = 0;
  const committed = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>(),
    result = Promise.withResolvers<{
      last_status: "failed";
      last_message: string;
      last_branch: string;
    }>();
  const messages: any[] = [];
  const rpc = () =>
    createSettingsRpcHandler({
      connectionId: "studio",
      settings: store.settings,
      runtimeStatus: store.runtimeStatus,
      herdr: {} as any,
      sshHost: () => undefined,
      readWorktreeHooks: async () => null,
      resolveWorkspaceGitRoot: async () => ({
        workspace: { label: "Synthetic workspace" },
        root: "/synthetic/repo",
      }),
      workspaceAutoSyncIsRunning: () => false,
      onWorkspaceAutoSyncSettingsChanged: () => {},
      safeSend: (_ws, payload) => {
        messages.push(JSON.parse(payload));
        return true;
      },
      markRpcError: () => {},
    });
  const auto = createWorkspaceAutoSync({
    connectionId: "studio",
    herdr: {
      call: async () => ({
        workspaces: [{ workspace_id: "workspace-a", cwd: "/synthetic/repo" }],
      }),
    } as any,
    sshHost: () => undefined,
    shQuote,
    runProcessWithCodeTimeout: async () => {
      throw new Error("synthetic sync seam owns Git");
    },
    invalidateGitStatus: () => {},
    resolveWorkspaceGitRoot: async () => ({ root: "/synthetic/repo" }),
    readSettings: store.settings.read,
    runtimeStatus: {
      get: store.runtimeStatus.get,
      put: async (key, status) => {
        const saved = await store.runtimeStatus.put(key, status);
        committed.resolve();
        return saved;
      },
    },
    syncBranch: async () => {
      syncCalls++;
      started.resolve();
      return result.promise;
    },
  });
  try {
    await store.settings.read();
    auto.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(syncCalls).toBe(0); // imported last-run time controls the interval
    auto.settingsChanged(key, true);
    await started.promise;
    await rpc()(
      {} as any,
      "toggle",
      "settings.workspace_auto_sync.update_key",
      { key, enabled: false },
    );
    expect(messages.find((m) => m.id === "toggle").result).toMatchObject({
      enabled: false,
      last_status: "updated",
    });
    result.resolve({
      last_status: "failed",
      last_message: "Synthetic conflict",
      last_branch: "feature/synthetic",
    });
    await committed.promise;
    await auto.stop();
    expect(syncCalls).toBe(1);
    expect(store.runtimeStatus.get(key)).toMatchObject({
      last_status: "failed",
      last_message: "Synthetic conflict",
    });
    const disk = JSON.parse(readFileSync(paths.settings, "utf8"));
    expect(disk.workspace_auto_sync[key].enabled).toBe(false);
    expect(disk.workspace_auto_sync[key]).not.toHaveProperty("last_status");
    await store.close();
    store = await openStorage(paths, {
      clock: systemClock,
      scheduler: systemScheduler,
    });
    await rpc()({} as any, "get", "settings.workspace_auto_sync.get", {
      workspace_id: "workspace-a",
    });
    await rpc()({} as any, "list", "settings.workspace_auto_sync.list", {});
    await rpc()({} as any, "update", "settings.workspace_auto_sync.update", {
      workspace_id: "workspace-a",
      enabled: true,
    });
    for (const id of ["get", "update"])
      expect(messages.find((m) => m.id === id).result).toMatchObject({
        last_status: "failed",
        last_message: "Synthetic conflict",
        last_branch: "feature/synthetic",
      });
    expect(messages.find((m) => m.id === "get").result.enabled).toBe(false);
    expect(messages.find((m) => m.id === "list").result.configs).toHaveLength(
      1,
    );
    expect(
      messages.find((m) => m.id === "list").result.configs[0],
    ).toMatchObject({ key, last_status: "failed" });
    await rpc()({} as any, "generic", "settings.get", {});
    await rpc()({} as any, "repo", "settings.update_repo", {
      key,
      settings: { worktree_hooks_enabled: true },
    });
    for (const id of ["generic", "repo"]) {
      expect(
        messages.find((message) => message.id === id).result.settings
          .workspace_auto_sync[key],
      ).toMatchObject({
        last_status: "failed",
        last_message: "Synthetic conflict",
      });
    }
    expect(store.runtimeStatus.get(other)).toEqual({ last_status: "failed" });
  } finally {
    result.resolve({
      last_status: "failed",
      last_message: "cleanup",
      last_branch: "synthetic",
    });
    await auto.stop();
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
