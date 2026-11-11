import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGuiSettings, repoSettingsKey } from "../config/gui-settings";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
} from "../connections/profile-service";
import { ConnectionProfileStore } from "../connections/profiles";
import { memoryCoreTopologyPort } from "../storage/core-topology";
import { silentLogger } from "../utils/logger";
import { createCoreConnections } from "./connections";
import { CoreOperationFence } from "./fence";
import { createCoreHostRuntime } from "./host-runtime";
import type { CoreKillConfirmation } from "./kill-plan";
import { launchCore, planCoreKill } from "./operations";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";
import { localCoreTransport } from "./transport";
import {
  createCoreWorktree,
  openCoreWorktree,
  removeCoreWorktree,
} from "./worktrees";

/**
 * Files, screen reads and worktrees for a core agent against a real
 * herdr-core release (P4), in a disposable repository. Opt in with
 * HERDR_CORE_BIN=<official binary>; Linux only, under scratch HOME/XDG
 * directories, every process killed after.
 */
const bin = scratchCoreBinary();
const live = bin ? test : test.skip;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(predicate: () => boolean | Promise<boolean>, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(10);
  }
}

function git(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.email=dev@example.com",
      "-c",
      "user.name=Example",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
  );
  if (run.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

async function connected(stateDir: string, root: string) {
  const topology = memoryCoreTopologyPort();
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: () => localCoreTransport(stateDir),
    topology: () => topology,
  });
  cleanups.push(() => core.stop());
  const store = new ConnectionProfileStore({
    path: join(root, "connections.json"),
  });
  const service: ConnectionProfileService<ConnectionRuntime, never> =
    new ConnectionProfileService({
      manager: new ConnectionManager<ConnectionRuntime>("startup-default"),
      core: core.support as never,
      store,
      bootstrap: loadConnectionProfileBootstrap({
        store,
        startupProfile: {
          id: "startup-default",
          label: "Default",
          type: "local",
          control_socket_path: "/synthetic/herdr.sock",
          client_socket_path: "/synthetic/herdr-client.sock",
          auto_connect: false,
        },
        explicitStartupOverride: false,
      }),
      createRuntime: () => () => ({
        identity: {
          id: "startup-default",
          label: "Default",
          source: "startup-config",
        },
        startTransport: async () => {},
        startBackground: () => {},
        stop: async () => {},
      }),
      retry: { baseDelayMs: 20, maxDelayMs: 200, random: () => 0 },
    });
  await service.create({
    id: "core",
    label: "Scratch core",
    type: "local",
    runtime: "herdr-core",
    core_session: "default",
    core_state_dir: stateDir,
    auto_connect: true,
  });
  await until(() => core.manager.status("core").state === "ready");
  const lease = () => core.manager.readyRuntimeLease("core")!;
  return { core, topology, lease };
}

describe("a core agent's files and worktrees on a real herdr-core", () => {
  live(
    "Files and a screen read for an agent; worktree create, open and remove",
    async () => {
      const scratchCore = new ScratchCore(bin!);
      cleanups.push(() => scratchCore.dispose());
      await scratchCore.start();
      const root = mkdtempSync(join(tmpdir(), "hcw-wt-live-"));
      cleanups.push(() => rmSync(root, { recursive: true, force: true }));
      const repo = join(root, "repo");
      mkdirSync(repo);
      git(repo, "init", "-q");
      writeFileSync(join(repo, "README.md"), "example\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "init");
      const w = await connected(scratchCore.stateDir, root);
      // An agent core started in the repository (a shell stands in for it).
      const agent = await w
        .lease()
        .runtime.run(CoreOperationFence.admit(w.lease()), {
          argv: ["/bin/sh", "-c", "printf 'agent ready\\n'; exec sleep 600"],
          cwd: repo,
          labels: {},
          keep: false,
        });
      await until(
        () =>
          (
            w.lease().runtime.core.terminal(agent.address)?.foreground as
              | { cwd?: string }
              | undefined
          )?.cwd === repo,
      );
      const settings = defaultGuiSettings();
      settings.repositories[repoSettingsKey(repo, undefined, "core")] = {
        worktree_directory: join(root, "worktrees"),
      } as never;
      const host = createCoreHostRuntime({
        lease: w.lease(),
        host: null,
        readSettings: async () => settings,
      });
      // Files of the agent's room, through World's helpers.
      const files = (await host.files.listWorkspaceFiles({
        workspace_id: "hc:unplaced",
      })) as { entries?: Array<{ name: string }> };
      expect(files.entries?.map((e) => e.name)).toContain("README.md");
      // Its worktree, from core's live foreground cwd.
      const observed = await host.agentWorktree.get(
        {
          connectionId: "core",
          generation: w.lease().generation,
          paneId: agent.address,
          terminalId: agent.address,
          sessionFingerprint: null,
        },
        { refresh: true },
      );
      expect(observed).toMatchObject({
        state: "resolved",
        candidates: [{ source: "foreground_cwd", canonicalRoot: repo }],
      });
      // Core accepts the screen-only read and answers the screen.
      const screen = await host.operations.readTerminal({
        pane_id: agent.address,
      });
      expect(screen.read).toMatchObject({
        pane_id: agent.address,
        source: "screen",
      });
      expect(String((screen.read as { text: string }).text)).toContain(
        "agent ready",
      );
      // A worktree as World's room; a shell started there runs in it.
      const deps = { topology: w.topology, host };
      const created = await createCoreWorktree(w.lease(), deps, {
        workspaceId: "hc:unplaced",
        branch: "live-feature",
      });
      expect(existsSync(join(created.checkout_path, "README.md"))).toBe(true);
      const shell = await launchCore(
        w.lease(),
        {
          workspaceId: created.workspace_id,
          kind: null,
          label: "Shell",
          text: "",
        },
        { topology: w.topology, resolveExecutable: async () => "/bin/sh" },
      );
      const address = shell.status === "started" ? shell.terminal_id : "";
      await until(
        () => w.lease().runtime.core.terminal(address)?.state === "live",
      );
      // What core itself recorded about the new terminal's folder.
      expect(
        JSON.parse(await scratchCore.hc("get", address, "--json")),
      ).toMatchObject({ cwd: created.checkout_path });
      // The same native path delivers asks and Ranger prompts for any
      // harness. A scratch shell proves paste+Enter reaches core, without
      // installing or authorizing any real harness.
      await until(() =>
        Boolean(w.lease().runtime.core.terminal(address)?.foreground),
      );
      const dimensions = JSON.parse(
        await scratchCore.hc("get", address, "--json"),
      );
      const fence = CoreOperationFence.admit(w.lease(), address);
      await w
        .lease()
        .runtime.send(fence, "printf core_answer_accepted", async () => true);
      await until(async () =>
        String(
          (
            (await host.operations.readTerminal({ pane_id: address })).read as {
              text?: string;
            }
          )?.text ?? "",
        ).includes("core_answer_accepted"),
      );
      const afterRead = JSON.parse(
        await scratchCore.hc("get", address, "--json"),
      );
      expect([afterRead.cols, afterRead.rows]).toEqual([
        dimensions.cols,
        dimensions.rows,
      ]);
      // Open: an existing worktree becomes a room.
      const elsewhere = join(root, "elsewhere");
      git(repo, "worktree", "add", "-q", "-b", "live-fix", elsewhere);
      const opened = await openCoreWorktree(w.lease(), deps, {
        workspaceId: "hc:unplaced",
        path: elsewhere,
      });
      expect(opened).toMatchObject({ label: "live-fix" });
      // Remove: confirmed terminals end in core, then Git removes it.
      const plan = await planCoreKill(w.lease(), [address]);
      const removed = await removeCoreWorktree(w.lease(), deps, {
        workspaceId: created.workspace_id,
        force: false,
        confirmation: {
          coreId: plan.core_id,
          terminals: [...plan.roots, ...plan.descendants].map((e) => ({
            address: e.address,
            pid: e.pid,
            occupant: e.occupant,
            remote: e.remote,
          })),
        } as CoreKillConfirmation,
      });
      expect(removed).toMatchObject({ ok: true, killed: [address] });
      await until(
        () => w.lease().runtime.core.terminal(address)?.state !== "live",
      );
      expect(existsSync(created.checkout_path)).toBe(false);
      expect(git(repo, "worktree", "list")).not.toContain("live-feature");
      // The agent outside the worktree is untouched.
      expect(w.lease().runtime.core.terminal(agent.address)?.state).toBe(
        "live",
      );
    },
    60_000,
  );
});
