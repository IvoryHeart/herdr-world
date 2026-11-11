import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantWorkspaceRef } from "../../../shared/assistant";
import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import {
  defaultGuiSettings,
  type GuiSettings,
  repoSettingsKey,
} from "../config/gui-settings";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { createCoreHostRuntime } from "../herdr-core/host-runtime";
import { coreWorld, until } from "../herdr-core/testing/core-world";
import { CORE_UNPLACED_WORKSPACE } from "../herdr-core/topology";
import { createCoreWorktree } from "../herdr-core/worktrees";
import { CORE_HISTORY_UNAVAILABLE, createAssistantContext } from "./context";

/**
 * Ranger over herdr-core workspaces (P4), through the real core provider
 * against an in-process core: reads come from World's read model and core's
 * own screen read (`lines: 0`), Git runs on a real repository, and every
 * assertion about what reached core reads the calls core received.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Example",
      GIT_AUTHOR_EMAIL: "dev@example.com",
      GIT_COMMITTER_NAME: "Example",
      GIT_COMMITTER_EMAIL: "dev@example.com",
    },
  });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString();
}

/** A repository with one commit and one unstaged change. */
function repository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hcw-ranger-")));
  dirs.push(root);
  const repo = join(root, "repo");
  Bun.spawnSync(["mkdir", "-p", repo]);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "notes.md"), "one\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "start");
  writeFileSync(join(repo, "notes.md"), "one\ntwo\n");
  return { root, repo };
}

async function setup(
  options: { settings?: (connectionId: string) => GuiSettings } = {},
) {
  const { root, repo } = repository();
  const w = await coreWorld();
  worlds.push(w);
  // An agent working in the repository, and a plain shell.
  const agent = w.fake.create({
    name: "builder",
    argv: ["claude"],
    cwd: repo,
    foreground: { pid: 7001, name: "claude", argv: ["claude"], cwd: repo },
  });
  w.fake.report(agent, { state: "working", app: "claude-code" });
  await w.connect();
  await w.settle();
  const settings = () =>
    Promise.resolve(options.settings?.("box") ?? defaultGuiSettings());
  const leaseOf = () => {
    const lease = w.core.manager.readyRuntimeLease("box");
    if (!lease?.isCurrent()) return null;
    return {
      runtime: createCoreHostRuntime({
        lease,
        host: null,
        readSettings: settings,
      }),
      generation: lease.generation,
      isCurrent: () => lease.isCurrent(),
    };
  };
  // A Herdr (TUI) connection whose IDs collide with the core's: the same
  // pane/terminal address and the same workspace ID.
  const tuiCall = mock(
    async (method: string, params: Record<string, unknown> = {}) => {
      const pane = {
        pane_id: agent,
        terminal_id: agent,
        workspace_id: CORE_UNPLACED_WORKSPACE,
        tab_id: "tab",
        agent: "codex",
      };
      if (method === "workspace.list")
        return {
          workspaces: [
            { workspace_id: CORE_UNPLACED_WORKSPACE, label: "TUI room" },
          ],
        };
      if (method === "workspace.get")
        return {
          workspace: { workspace_id: params.workspace_id, label: "TUI room" },
        };
      if (method === "pane.list" || method === "pane.get")
        return method === "pane.get" ? { pane } : { panes: [pane] };
      if (method === "pane.read")
        return {
          read: { ...pane, text: "tui screen", source: "recent" },
        };
      throw new Error(`unexpected ${method}`);
    },
  );
  const tuiRuntime = herdrRuntimeFixture({
    call: tuiCall,
  }) as unknown as LegacyConnectionRuntime;
  const context = createAssistantContext({
    catalog: () => [
      { id: "tui", label: "Herdr" },
      { id: "box", label: "Core box" },
    ],
    lease: (id) =>
      id === "tui"
        ? { runtime: tuiRuntime, generation: 7, isCurrent: () => true }
        : leaseOf(),
    createCoreWorktree: (host, request) =>
      createCoreWorktree(host.lease, { topology: w.topology, host }, request),
  });
  const coreRef: AssistantWorkspaceRef = {
    connection_id: "box",
    workspace_id: CORE_UNPLACED_WORKSPACE,
  };
  return { w, root, repo, agent, context, coreRef, tuiCall };
}

const reads = (w: World) =>
  w.fake.calls.filter((c) => c.method === "terminal.read");
const writes = (w: World) =>
  w.fake.calls.filter((c) =>
    [
      "terminal.send",
      "terminal.keys",
      "terminal.kill",
      "terminal.run",
    ].includes(c.method),
  );

describe("Ranger over herdr-core workspaces", () => {
  test("the catalog lists core rooms under the core's generation", async () => {
    const { w, context } = await setup();
    const catalog = await context.catalog();
    const generation = w.lease().generation;
    expect(catalog.workspaces).toContainEqual(
      expect.objectContaining({
        connection_id: "box",
        workspace_id: CORE_UNPLACED_WORKSPACE,
        connection_label: "Core box",
        runtime_generation: generation,
      }),
    );
    expect(catalog.complete_connection_ids).toContain("box");
  });

  test("status and the terminal screen are read; core sees only a screen read", async () => {
    const { w, agent, context, coreRef } = await setup();
    const scope = await context.captureScope([coreRef]);
    const status = JSON.parse(
      (await context.read("status", scope, coreRef)).text,
    )[0];
    expect(status.runtime).toBe("herdr-core");
    expect(status.panes).toContainEqual(
      expect.objectContaining({ pane_id: agent, agent: "claude" }),
    );
    const screen = JSON.parse(
      (
        await context.read("terminal", scope, {
          ...coreRef,
          pane_id: agent,
          lines: 500,
        })
      ).text,
    )[0];
    expect(screen.text).toBe("$");
    expect(screen.terminal_window).toContain("Only the visible screen");
    // `lines` never reaches core: a history read would scroll the program.
    expect(reads(w).map((c) => c.params)).toEqual([
      { terminal: agent, lines: 0 },
    ]);
    expect(writes(w)).toEqual([]);
  });

  test("Git diffs come from the core agent's repository", async () => {
    const { context, coreRef } = await setup();
    const scope = await context.captureScope([coreRef]);
    const summary = JSON.parse(
      (await context.read("diff", scope, coreRef)).text,
    )[0];
    expect(summary.entries).toContainEqual(
      expect.objectContaining({ path: "notes.md", kind: "unstaged" }),
    );
    const file = JSON.parse(
      (
        await context.read("diff", scope, {
          ...coreRef,
          path: "notes.md",
          kind: "unstaged",
        })
      ).text,
    )[0];
    expect(file.diff).toContain("+two");
  });

  test("colliding IDs: each read goes to its own connection only", async () => {
    const { w, agent, context, coreRef, tuiCall } = await setup();
    const tuiRef = { ...coreRef, connection_id: "tui" };
    const scope = await context.captureScope([coreRef, tuiRef]);
    const core = JSON.parse(
      (await context.read("terminal", scope, { ...coreRef, pane_id: agent }))
        .text,
    )[0];
    const tui = JSON.parse(
      (await context.read("terminal", scope, { ...tuiRef, pane_id: agent }))
        .text,
    )[0];
    expect(core).toMatchObject({ connection_id: "box", text: "$" });
    expect(tui).toMatchObject({ connection_id: "tui", text: "tui screen" });
    expect(reads(w)).toHaveLength(1);
    expect(
      tuiCall.mock.calls.filter(([method]) => method === "pane.read"),
    ).toHaveLength(1);
  });

  test("a retired lease reads nothing more", async () => {
    const { w, agent, context, coreRef } = await setup();
    const scope = await context.captureScope([coreRef]);
    const before = reads(w).length;
    w.fake.kill(w.socket);
    await until(() => !w.core.manager.readyRuntimeLease("box")?.isCurrent());
    await expect(
      context.read("terminal", scope, { ...coreRef, pane_id: agent }),
    ).rejects.toThrow("Connection changed during Ranger read");
    expect(reads(w)).toHaveLength(before);
  });

  test("a mentioned core agent replaced in place is refused", async () => {
    const { w, agent, context, coreRef } = await setup();
    const scope = await context.captureScope([coreRef]);
    const mentions = await context.mentionCatalog(scope);
    const mention = mentions.targets.find(
      (target) => target.kind === "agent" && target.pane_id === agent,
    );
    expect(mention).toMatchObject({ agent: "claude", label: "builder" });
    await context.bindMentions(scope, [mention!]);
    // A kept terminal loses its program; a new one of the same harness
    // takes the address and even the pid.
    w.fake.replaceWithShell(agent, { reusePid: true });
    w.fake.foreground(agent, {
      pid: 7001,
      name: "claude",
      argv: ["claude"],
      cwd: "/tmp/example",
    });
    w.fake.report(agent, { state: "idle", app: "claude-code" });
    await w.settle();
    await expect(
      context.read("terminal", scope, { ...coreRef, pane_id: agent }),
    ).rejects.toThrow("Mentioned agent session changed");
  });

  test("history is explicit; a confirmed prompt uses native core delivery", async () => {
    const { w, agent, context, coreRef } = await setup();
    const scope = await context.captureScope([coreRef]);
    await expect(
      context.read("history", scope, { ...coreRef, pane_id: agent }),
    ).rejects.toThrow(CORE_HISTORY_UNAVAILABLE);
    const send = await context.prepareAction("send_prompt", scope, {
      ...coreRef,
      pane_id: agent,
      prompt: "hello",
    });
    expect(writes(w)).toEqual([]);
    expect((await send.execute(() => true)).status).toBe("succeeded");
    expect(w.fake.calls.filter((c) => c.method === "terminal.send")).toEqual([
      {
        method: "terminal.send",
        params: { terminal: agent, text: "hello", force: false, wait: false },
      },
    ]);
    await expect(
      context.prepareAction("close_agent", scope, {
        ...coreRef,
        pane_id: agent,
      }),
    ).rejects.toThrow("World confirms by name every child");
    expect(writes(w).map((c) => c.method)).toEqual(["terminal.send"]);
  });

  test("a changed setup hook invalidates Ranger's worktree preview before creating anything", async () => {
    const settings = defaultGuiSettings();
    const { context, coreRef, repo, root } = await setup({
      settings: () => settings,
    });
    settings.repositories[repoSettingsKey(repo, null, coreRef.connection_id)] =
      { worktree_directory: join(root, "worktrees") };
    writeFileSync(
      join(repo, "paseo.json"),
      JSON.stringify({ worktree: { setup: "printf first" } }),
    );
    const scope = await context.captureScope([coreRef]);
    const action = await context.prepareAction("create_worktree", scope, {
      ...coreRef,
      branch: "hook-race",
    });
    writeFileSync(
      join(repo, "paseo.json"),
      JSON.stringify({ worktree: { setup: "printf second" } }),
    );
    expect((await action.execute(() => true)).status).toBe("failed");
    expect(git(repo, "worktree", "list")).not.toContain("hook-race");
  });

  test("a confirmed worktree action creates a worktree room on the core host", async () => {
    let directory = "";
    let repoPath = "";
    const { w, context, coreRef, root, repo } = await setup({
      settings: (connectionId) => {
        const settings = defaultGuiSettings();
        settings.repositories[repoSettingsKey(repoPath, null, connectionId)] = {
          worktree_directory: directory,
        };
        return settings;
      },
    });
    directory = join(root, "worktrees");
    repoPath = repo;
    const scope = await context.captureScope([coreRef]);
    const prepared = await context.prepareAction("create_worktree", scope, {
      ...coreRef,
      branch: "feature-x",
    });
    expect(prepared.preview.params).toMatchObject({
      branch: "feature-x",
      cwd: repo,
      runtime: "herdr-core",
    });
    const result = await prepared.execute(() => true);
    expect(result.status).toBe("succeeded");
    expect(git(repo, "worktree", "list")).toContain(
      join(directory, "feature-x"),
    );
    const room = w.topology
      .get(w.lease().runtime.core.epoch!.coreId)
      .rooms.find((r) => r.checkout?.branch === "feature-x");
    expect(room?.checkout).toMatchObject({
      path: join(directory, "feature-x"),
      source: repo,
    });
    // No terminal was started, typed into or ended.
    expect(writes(w)).toEqual([]);
  });
});
