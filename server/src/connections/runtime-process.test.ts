import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as os from "node:os";
import { join } from "node:path";
import { createLegacyConnectionRuntime } from "./runtime";
import { sshCommandArgv } from "../bridge/ssh-command";
import { inspectRuntimeWorkspacePath } from "../workspace/path";
import { createWorkspaceWorktree } from "../worktree/create";
import { createGuiSettingsStore } from "../config/gui-settings";
import { systemClock, systemScheduler } from "../service/ports";
import { memoryRuntimeStatus } from "../storage/testing/runtime-status";
import { probeLauncher } from "../rpc/launcher-probe";
import { enrichIntegrationVersions } from "../herdr/integration-versions";
import * as processUtils from "../utils/process-utils";
import * as inputProcess from "../workspace/process";
import {
  acquireSshSession,
  registerSshMaster,
  unregisterSshMaster,
  SSH_SESSION_LIMIT,
} from "../bridge/ssh-sessions";

// Extends the independent second-repair-ignore-retirement reproduction: its
// first read runs, then its transitive input helper must wait behind a reserve.
const operations = [
  "directory",
  "upload",
  "search",
  "path",
  "worktree",
  "ignore",
  "git",
  "status",
  "forward-local-scan",
  "forward-remote-scan",
  "launcher-readiness",
  "launcher-skills",
  "integration-versions",
  "local-archive",
  "local-claude-successor",
] as const;
test.each(
  operations.flatMap((operation) =>
    [false, true].map((retired) => ({ operation, retired })),
  ),
)(
  "queued $operation retains runtime authority (retired=$retired)",
  async ({ operation, retired }) => {
    const root = mkdtempSync(join(tmpdir(), "runtime-process-"));
    const destination = "queued.example";
    const deferredPort =
      operation === "local-archive" ||
      operation === "local-claude-successor" ||
      operation === "forward-remote-scan";
    const held = await Promise.all(
      Array.from(
        {
          length: deferredPort
            ? 0
            : SSH_SESSION_LIMIT - (operation === "ignore" ? 1 : 0),
        },
        () => acquireSshSession(destination),
      ),
    );
    const owners: object[] = [];
    const mocks: Array<{ mockRestore(): void }> = [];
    const runtimes: ReturnType<typeof createLegacyConnectionRuntime>[] = [];
    const reached = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const releasePort = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const binds = [0, 0];
    const reserves: Array<Promise<() => void>> = [];
    const localOwners = new WeakMap<string[], number>();
    const spawns: Array<{ argv: string[]; owner: number }> = [];
    let portOwner = 0;
    if (deferredPort) {
      const target =
        operation === "local-archive" || operation === "local-claude-successor"
          ? inputProcess
          : processUtils;
      const key =
        operation === "local-archive" || operation === "local-claude-successor"
          ? "runBinaryProcessWithTimeout"
          : "runProcess";
      const original = (target as any)[key];
      mocks.push(
        spyOn(target as any, key).mockImplementation(async (...args: any[]) => {
          const index = portOwner++;
          localOwners.set(args[0], index);
          reached[index].resolve();
          await releasePort[index].promise;
          return original(...args);
        }),
      );
    }
    if (operation === "local-claude-successor")
      mocks.push(spyOn(os, "homedir").mockReturnValue(root));
    function runtime(index: number) {
      const id = index === 0 ? "alpha" : "beta";
      const sessionId =
        index === 0
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222";
      const checkout =
        operation === "local-claude-successor"
          ? join(root, ".claude", "projects", id)
          : operation === "local-archive"
            ? join(root, id, "checkout")
            : `/synthetic/${id}/checkout`;
      if (
        operation === "local-archive" ||
        operation === "local-claude-successor"
      ) {
        mkdirSync(join(checkout, "folder"), { recursive: true });
        if (operation === "local-claude-successor")
          writeFileSync(
            join(checkout, `${sessionId}.jsonl`),
            JSON.stringify({
              type: "user",
              sessionId,
              message: { role: "user", content: "Synthetic" },
            }) + "\n",
          );
      }
      const controlPath = `/synthetic/${id}/m.ctl`;
      const owner = {};
      owners.push(owner);
      registerSshMaster(owner, {
        destination,
        controlPath,
        isListening: () => {
          binds[index]++;
          if (operation !== "ignore" || binds[index] === 2)
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
          sshHost:
            operation === "local-archive" ||
            operation === "local-claude-successor"
              ? undefined
              : destination,
          masterControlPath: controlPath,
          remoteSocketPath: "/synthetic/control.sock",
          remoteClientSocketPath: "/synthetic/render.sock",
          hasExplicitSocketPath: true,
          hasExplicitClientSocketPath: true,
        },
        forwards: {
          list: () => [],
          loseConnection() {},
          async drainConnection() {},
        } as any,
        safeSend: () => true,
        clientLabel: () => "test",
        markRpcError: () => {},
        onEvent: () => {},
      });
      mocks.push(
        spyOn(value.herdr, "call").mockImplementation(async (method) => {
          if (operation === "local-claude-successor" && method === "agent.get")
            return {
              agent: {
                agent: "claude",
                workspace_id: "w1",
                agent_session: {
                  agent: "claude",
                  source: "herdr:claude",
                  kind: "id",
                  value: sessionId,
                },
              },
            };
          if (method === "server.agent_manifests")
            return { manifests: [{ agent: "claude" }] };
          if (method === "pane.list")
            return { panes: [{ workspace_id: "w1", cwd: checkout }] };
          return {
            workspace: {
              workspace_id: "w1",
              worktree: { checkout_path: checkout },
            },
          };
        }),
      );
      runtimes.push(value);
      return value;
    }
    const alpha = runtime(0),
      beta = runtime(1);
    const spawn = spyOn(Bun, "spawn").mockImplementation((argv: any) => {
      const index =
        localOwners.get(argv) ?? (argv[2] === "/synthetic/beta/m.ctl" ? 1 : 0);
      spawns.push({ argv, owner: index });
      if (operation === "ignore" && binds[index] === 1)
        reserves[index] = acquireSshSession(destination);
      const stdout =
        operation === "ignore"
          ? binds[index] === 1
            ? `ROOT\t${Buffer.from(`/synthetic/${index ? "beta" : "alpha"}/checkout`).toString("base64")}\nENTRY\tfile\t7\t0\tc2FtcGxlLnR4dA==\n`
            : "sample.txt\0"
          : operation === "upload"
            ? "META\tc2FtcGxlLnR4dA==\t7\t0\n"
            : operation === "search"
              ? "sample.txt\0"
              : operation === "path"
                ? `PATH\t${Buffer.from("/synthetic/checkout").toString("base64")}\nERROR\t\n`
                : operation === "integration-versions"
                  ? "herdr 0.10.0\nclaude: current (v1)\n"
                  : "";
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
        stdout: new Response(stdout).body!,
        stderr: new Response("").body!,
        kill() {},
      } as any;
    });
    function run(value: typeof alpha, name: string) {
      const params = { workspace_id: "w1" };
      if (operation === "directory")
        return value.files.createWorkspaceDirectory({ ...params, name });
      if (operation === "upload")
        return value.files.uploadWorkspaceFile(
          { ...params, filename: "sample.txt", directory: "" },
          new Request("http://world.example/upload", {
            method: "POST",
            body: "payload",
          }),
        );
      if (operation === "search")
        return value.files.searchWorkspaceFiles({
          ...params,
          query: "sample",
          mode: "files",
        });
      if (operation === "path")
        return inspectRuntimeWorkspacePath(value, "/synthetic/checkout");
      if (operation === "ignore")
        return value.files.listWorkspaceFiles({ ...params, path: "" });
      if (operation === "git") return value.files.readGitCommits(params);
      if (operation === "status")
        return value.status.enrichWorkspacesWithGitStatus({
          workspaces: [
            {
              ...params,
              worktree: {
                checkout_path: `/synthetic/${value.identity.id}/checkout`,
              },
            },
          ],
        });
      if (
        operation === "forward-local-scan" ||
        operation === "forward-remote-scan"
      )
        return value.handleForwardRpc!(
          {} as any,
          "scan",
          "forward.candidates",
          {
            direction: operation === "forward-remote-scan" ? "remote" : "local",
          },
          () => true,
        );
      if (operation === "launcher-readiness" || operation === "launcher-skills")
        return probeLauncher(
          { connection: value, params, requestIsCurrent: () => true } as any,
          operation === "launcher-skills",
          value.runProcessWithCodeTimeout,
        );
      if (operation === "integration-versions")
        return enrichIntegrationVersions(
          { integrations: [{ target: "claude", state: "current" }] },
          {
            sshHost: value.sshHost(),
            ping: async () => ({ version: "0.10.0" }),
            run: value.runProcessWithCodeTimeout,
          },
        );
      if (operation === "local-claude-successor")
        return value.agentSessions.readHistory({
          pane_id: "synthetic-pane",
          agent: "claude",
          history_version: 2,
        });
      if (operation === "local-archive")
        return value.files.downloadWorkspaceFile({ ...params, path: "folder" });
      return createWorkspaceWorktree(
        value,
        params,
        () => true,
        () => {},
        async ({ runProcessWithCodeTimeout }) => {
          await runProcessWithCodeTimeout(
            sshCommandArgv(destination, "git fetch origin"),
            1000,
          );
          throw new Error("synthetic base sync complete");
        },
      );
    }
    const pending = run(alpha, "new-directory").catch((error) => error);
    let peer: Promise<unknown> | undefined;
    try {
      await reached[0].promise;
      if (operation === "ignore") await reserves[0];
      const before = spawns.length;
      expect(before).toBe(operation === "ignore" ? 1 : 0);
      if (retired) {
        peer = run(beta, "peer-directory").catch((error) => error);
        if (operation !== "ignore") await reached[1].promise;
        await alpha.stop();
        if (operation === "ignore") {
          (await reserves[0])();
          await reached[1].promise;
        }
        if (operation === "ignore") (await reserves[1])();
      }
      if (deferredPort) {
        releasePort[0].resolve();
        releasePort[1].resolve();
      } else if (operation === "ignore") {
        if (!retired) (await reserves[0])();
      } else held[0]();
      await pending;
      await peer;
      await Promise.all(
        runtimes.map((r) => r.status.gitStatusRefreshSettled()),
      );
      const after = spawns.slice(before);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((s) => s.owner === (retired ? 1 : 0))).toBe(true);
      if (retired) expect(after.filter((s) => s.owner === 0)).toHaveLength(0);
      if (!deferredPort)
        for (const s of spawns)
          expect(s.argv.slice(0, 3)).toEqual([
            "ssh",
            "-S",
            `/synthetic/${s.owner ? "beta" : "alpha"}/m.ctl`,
          ]);
      if (
        [
          "upload",
          "search",
          "path",
          "ignore",
          "launcher-readiness",
          "launcher-skills",
          "integration-versions",
          "local-archive",
          "local-claude-successor",
        ].includes(operation)
      )
        expect(await (retired ? peer : pending)).not.toBeInstanceOf(Error);
    } finally {
      for (const release of held) release();
      for (const reserve of reserves) if (reserve) (await reserve)();
      releasePort.forEach((p) => p.resolve());
      await pending;
      await peer;
      spawn.mockRestore();
      for (const mock of mocks.reverse()) mock.mockRestore();
      for (const owner of owners) unregisterSshMaster(owner);
      await Promise.all(runtimes.map((r) => r.stop()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("stopping the local runtime cancels its active Claude continuation child", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-claude-child-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const project = join(root, ".claude", "projects", "synthetic");
  mkdirSync(project, { recursive: true });
  const path = join(project, `${id}.jsonl`);
  const home = spyOn(os, "homedir").mockReturnValue(root);
  writeFileSync(
    path,
    JSON.stringify({
      type: "user",
      sessionId: id,
      message: { role: "user", content: "Synthetic" },
    }) + "\n",
  );
  const runtime = createLegacyConnectionRuntime({
    clock: systemClock,
    scheduler: systemScheduler,
    runtimeStatus: memoryRuntimeStatus(),
    settings: createGuiSettingsStore(join(root, "settings.json")),
    identity: { id: "alpha", label: "Alpha", source: "test" },
    connectionGeneration: 7,
    config: {
      socketPath: join(root, "control.sock"),
      clientSocketPath: join(root, "render.sock"),
      hasExplicitSocketPath: true,
      hasExplicitClientSocketPath: true,
    },
    safeSend: () => true,
    clientLabel: () => "test",
    markRpcError() {},
    onEvent() {},
  });
  const herdr = spyOn(runtime.herdr, "call").mockResolvedValue({
    agent: {
      agent: "claude",
      workspace_id: "w1",
      agent_session: {
        agent: "claude",
        source: "herdr:claude",
        kind: "id",
        value: id,
      },
    },
  });
  const began = Promise.withResolvers<void>(),
    exit = Promise.withResolvers<number>();
  let childSignal: AbortSignal | undefined;
  let killSignal: unknown;
  const spawn = spyOn(Bun, "spawn").mockImplementation(
    (argv: any, options: any = {}) => {
      expect(argv[0]).toBe("sh");
      childSignal = options.signal;
      killSignal = options.killSignal;
      began.resolve();
      return {
        exited: exit.promise,
        stdout: new Response("").body!,
        stderr: new Response("").body!,
        kill() {
          exit.resolve(137);
        },
      } as any;
    },
  );
  const reading = runtime.agentSessions
    .readHistory({
      pane_id: "synthetic-pane",
      agent: "claude",
      history_version: 2,
    })
    .catch((error) => error);
  try {
    await began.promise;
    await runtime.stop();
    expect(childSignal?.aborted).toBe(true);
    expect(killSignal).toBe("SIGKILL");
    exit.resolve(137);
    expect(await reading).toBeInstanceOf(Error);
  } finally {
    exit.resolve(0);
    await reading;
    await runtime.stop();
    spawn.mockRestore();
    herdr.mockRestore();
    home.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
