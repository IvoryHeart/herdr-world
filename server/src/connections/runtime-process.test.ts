import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyConnectionRuntime } from "./runtime";
import { sshCommandArgv } from "../bridge/ssh-command";
import { inspectRuntimeWorkspacePath } from "../workspace/path";
import { createWorkspaceWorktree } from "../worktree/create";
import { createGuiSettingsStore } from "../config/gui-settings";
import { systemClock, systemScheduler } from "../service/ports";
import { memoryRuntimeStatus } from "../storage/testing/runtime-status";
import {
  acquireSshSession,
  registerSshMaster,
  unregisterSshMaster,
  SSH_SESSION_LIMIT,
} from "../bridge/ssh-sessions";

const cases = ["directory", "upload", "search", "path", "worktree"] as const;
test.each(
  cases.flatMap((operation) =>
    [false, true].map((retired) => ({ operation, retired })),
  ),
)(
  "queued $operation retains runtime authority (retired=$retired)",
  async ({ operation, retired }) => {
    const root = mkdtempSync(join(tmpdir(), "runtime-process-"));
    const held = await Promise.all(
      Array.from({ length: SSH_SESSION_LIMIT }, () =>
        acquireSshSession("queued.example"),
      ),
    );
    const owners: object[] = [];
    const mocks: Array<{ mockRestore(): void }> = [];
    const runtimes: ReturnType<typeof createLegacyConnectionRuntime>[] = [];
    const reached = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const spawns: string[][] = [];
    function runtime(index: number) {
      const id = index === 0 ? "alpha" : "beta";
      const controlPath = `/synthetic/${id}/m.ctl`;
      const owner = {};
      owners.push(owner);
      registerSshMaster(owner, {
        destination: "queued.example",
        controlPath,
        isListening: () => {
          reached[index].resolve();
          return true;
        },
        isAlive: async () => true,
      });
      const value = createLegacyConnectionRuntime({
        clock: systemClock,
        scheduler: systemScheduler,
        runtimeStatus: memoryRuntimeStatus(),
        settings: createGuiSettingsStore(join(root, `${id}.json`)),
        identity: { id, label: id, source: "test" },
        connectionGeneration: 2,
        config: {
          socketPath: `/synthetic/${id}/control.sock`,
          clientSocketPath: `/synthetic/${id}/render.sock`,
          sshHost: "queued.example",
          masterControlPath: controlPath,
          remoteSocketPath: "/synthetic/remote-control.sock",
          remoteClientSocketPath: "/synthetic/remote-render.sock",
          hasExplicitSocketPath: true,
          hasExplicitClientSocketPath: true,
        },
        safeSend: () => true,
        clientLabel: () => "test",
        markRpcError: () => {},
        onEvent: () => {},
      });
      mocks.push(
        spyOn(value.herdr, "call").mockImplementation(async () => ({
          workspace: {
            workspace_id: "w1",
            worktree: { checkout_path: `/synthetic/${id}/checkout` },
          },
        })),
      );
      runtimes.push(value);
      return value;
    }
    const alpha = runtime(0),
      beta = runtime(1);
    const spawn = spyOn(Bun, "spawn").mockImplementation((argv: any) => {
      spawns.push(argv);
      return {
        exited: Promise.resolve(0),
        stdin: {
          write() {
            return 0;
          },
          end() {
            return 0;
          },
        },
        stdout: new Response(
          operation === "upload"
            ? "META\tc2FtcGxlLnR4dA==\t7\t0\n"
            : operation === "search"
              ? "sample.txt\0"
              : operation === "path"
                ? `PATH\t${Buffer.from("/synthetic/checkout").toString("base64")}\nERROR\t\n`
                : "",
        ).body!,
        stderr: new Response("").body!,
        kill() {},
      } as any;
    });
    function run(value: typeof alpha, name: string) {
      if (operation === "directory")
        return value.files.createWorkspaceDirectory({
          workspace_id: "w1",
          name,
        });
      if (operation === "upload")
        return value.files.uploadWorkspaceFile(
          { workspace_id: "w1", filename: "sample.txt", directory: "" },
          new Request("http://world.example/upload", {
            method: "POST",
            body: "payload",
          }),
        );
      if (operation === "search")
        return value.files.searchWorkspaceFiles({
          workspace_id: "w1",
          query: "sample",
          mode: "files",
        });
      if (operation === "path")
        return inspectRuntimeWorkspacePath(value, "/synthetic/checkout");
      return createWorkspaceWorktree(
        value,
        { workspace_id: "w1" },
        () => true,
        () => {},
        async ({ runProcessWithCodeTimeout }) => {
          await runProcessWithCodeTimeout(
            sshCommandArgv("queued.example", "git fetch origin"),
            1000,
          );
          throw new Error("synthetic base sync complete");
        },
      );
    }
    const mutation = run(alpha, "new-directory").catch((error) => error);
    let peer: Promise<unknown> | undefined;
    try {
      await reached[0].promise;
      expect(spawns).toHaveLength(0);
      if (retired) {
        peer = run(beta, "peer-directory").catch((error) => error);
        await reached[1].promise;
        await alpha.stop();
      }
      held[0]();
      await mutation;
      await peer;
      expect(spawns).toHaveLength(1);
      expect(spawns[0].slice(0, 3)).toEqual([
        "ssh",
        "-S",
        `/synthetic/${retired ? "beta" : "alpha"}/m.ctl`,
      ]);
      if (operation === "directory")
        expect(spawns[0].at(-1)).toContain(
          retired ? "peer-directory" : "new-directory",
        );
      if (retired)
        expect(await mutation).toMatchObject({
          message: "connection runtime retired",
        });
      if (
        operation === "upload" ||
        operation === "search" ||
        operation === "path"
      )
        expect(await (retired ? peer : mutation)).not.toBeInstanceOf(Error);
    } finally {
      for (const release of held) release();
      await mutation;
      await peer;
      spawn.mockRestore();
      for (const mock of mocks) mock.mockRestore();
      for (const owner of owners) unregisterSshMaster(owner);
      await Promise.all(runtimes.map((value) => value.stop()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
