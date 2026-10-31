import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage } from "../service/storage";
import { systemScheduler, type Clock, type Scheduler } from "../service/ports";
import { createWorkspaceAutoSync } from "./auto-sync";
import { shQuote } from "../utils/process-utils";
class VirtualTime implements Clock, Scheduler {
  value = Date.parse("2000-01-01T00:00:01.000Z");
  jobs = new Set<{ at: number; callback: () => void }>();
  now = () => this.value;
  monotonic = () => this.value;
  schedule(callback: () => void, delay: number) {
    const job = { at: this.value + delay, callback };
    this.jobs.add(job);
    return {
      cancel: () => {
        this.jobs.delete(job);
      },
    };
  }
  wakeAt(value: number) {
    this.value = value;
    for (const job of [...this.jobs])
      if (job.at <= value) {
        this.jobs.delete(job);
        job.callback();
      }
  }
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
test("virtual service time controls auto-sync not-due, due, force, persisted time and cancelled polling", async () => {
  const time = new VirtualTime(),
    initial = time.now(),
    root = mkdtempSync(join(tmpdir(), "auto-sync-clock-")),
    paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    key = "connection:studio:local:/synthetic/repo";
  const previous = {
    last_run_at: new Date(initial - 1000).toISOString(),
    last_status: "updated" as const,
  };
  writeFileSync(
    paths.settings,
    JSON.stringify({
      version: 1,
      workspace_auto_sync: {
        [key]: {
          enabled: true,
          interval_minutes: 10,
          checkout_path: "/synthetic/repo",
          ...previous,
        },
      },
    }),
    { mode: 0o600 },
  );
  // Real SQLite commits use their own group timer; only polling is virtual here.
  const store = await openStorage(paths, {
    clock: time,
    scheduler: systemScheduler,
  });
  let calls = 0;
  const results: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const auto = createWorkspaceAutoSync({
    clock: time,
    scheduler: time,
    connectionId: "studio",
    herdr: {
      call: async () => ({
        workspaces: [{ workspace_id: "workspace-a", cwd: "/synthetic/repo" }],
      }),
    } as any,
    sshHost: () => undefined,
    shQuote,
    runProcessWithCodeTimeout: async () => {
      throw new Error("synthetic Git seam");
    },
    invalidateGitStatus: () => {},
    resolveWorkspaceGitRoot: async () => ({ root: "/synthetic/repo" }),
    readSettings: store.settings.read,
    runtimeStatus: {
      get: store.runtimeStatus.get,
      put: async (key, status) => {
        const result = await store.runtimeStatus.put(key, status);
        results.at(-1)?.resolve();
        return result;
      },
    },
    syncBranch: async () => {
      calls++;
      return { last_status: "updated", last_message: `Synthetic run ${calls}` };
    },
  });
  try {
    await store.settings.read();
    auto.start();
    auto.start();
    await turn();
    expect(calls).toBe(0);
    expect(store.runtimeStatus.get(key)).toEqual(previous);
    expect(time.jobs.size).toBe(1);
    expect([...time.jobs][0]!.at).toBe(initial + 30_000);
    time.wakeAt(initial + 570_000);
    await turn();
    expect(calls).toBe(0);
    expect(time.jobs.size).toBe(1);
    const due = Promise.withResolvers<void>();
    results.push(due);
    time.wakeAt(initial + 600_000);
    await due.promise;
    await turn();
    expect(calls).toBe(1);
    expect(store.runtimeStatus.get(key)?.last_run_at).toBe(
      new Date(time.now()).toISOString(),
    );
    const forced = Promise.withResolvers<void>();
    results.push(forced);
    auto.settingsChanged(key, true);
    await forced.promise;
    await turn();
    expect(calls).toBe(2);
    expect(store.runtimeStatus.get(key)).toMatchObject({
      last_run_at: new Date(time.now()).toISOString(),
      last_message: "Synthetic run 2",
    });
    const cancelled = [...time.jobs][0]!;
    await auto.stop();
    expect(time.jobs.size).toBe(0);
    cancelled.callback();
    auto.settingsChanged(key, true);
    await turn();
    expect(calls).toBe(2);
    expect(time.jobs.size).toBe(0);
    auto.start();
    await turn();
    expect(time.jobs.size).toBe(1);
    expect(calls).toBe(2);
    cancelled.callback();
    await auto.stop();
    expect(time.jobs.size).toBe(0);
    time.wakeAt(time.now() + 1_200_000);
    await turn();
    expect(calls).toBe(2);
    expect(time.jobs.size).toBe(0);
  } finally {
    await Promise.all([auto.stop(), store.close()]);
    rmSync(root, { recursive: true, force: true });
  }
});
