import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGuiSettings, repoSettingsKey } from "../config/gui-settings";
import type { CoreKillConfirmation } from "./kill-plan";
import { createCoreHostRuntime } from "./host-runtime";
import { CoreOperationRefused, launchCore, planCoreKill } from "./operations";
import { coreWorld, until } from "./testing/core-world";
import {
  createCoreWorktree,
  listCoreWorktrees,
  openCoreWorktree,
  removeCoreWorktree,
} from "./worktrees";

/**
 * Git worktrees for core rooms (P4) against a real repository on this
 * computer and World's real provider over an in-process core. What reaches
 * core is read from the calls it received; what Git did, from Git.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

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

/** A repository with Paseo hooks that record when each one runs. */
function repository(root: string, hooks: Record<string, string> = {}) {
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  writeFileSync(join(repo, "README.md"), "example\n");
  const log = join(root, "hooks.log");
  writeFileSync(
    join(repo, "paseo.json"),
    JSON.stringify({
      worktree: {
        setup: `echo "setup $PASEO_CHECKOUT_PATH" >> ${log}`,
        opened: `echo "opened $PASEO_CHECKOUT_PATH" >> ${log}`,
        teardown: `echo "teardown $PASEO_CHECKOUT_PATH" >> ${log}`,
        removed: `echo "removed $PASEO_CHECKOUT_PATH" >> ${log}`,
        ...hooks,
      },
    }),
  );
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  return {
    repo: git(repo, "rev-parse", "--show-toplevel"),
    hooks: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
  };
}

async function world() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  return w;
}

/** The core's host is this computer; new worktrees go below the test root. */
function hostOf(w: World, repo: string) {
  const settings = defaultGuiSettings();
  settings.repositories[repoSettingsKey(repo, undefined, "box")] = {
    worktree_directory: join(w.root, "worktrees"),
  } as never;
  return createCoreHostRuntime({
    lease: w.lease(),
    host: null,
    readSettings: async () => settings,
  });
}

const confirmAll = (plan: Awaited<ReturnType<typeof planCoreKill>>) =>
  ({
    coreId: plan.core_id,
    terminals: [...plan.roots, ...plan.descendants].map((e) => ({
      address: e.address,
      pid: e.pid,
      occupant: e.occupant,
      remote: e.remote,
    })),
  }) as CoreKillConfirmation;

/** An agent working in `folder`, in the core's main room. */
async function agentIn(w: World, folder: string) {
  const address = w.fake.create({
    name: "builder",
    argv: ["/opt/example/bin/codex"],
    keep: true,
    cwd: folder,
    foreground: {
      pid: 4242,
      name: "codex",
      argv: ["/opt/example/bin/codex"],
      cwd: folder,
    },
  });
  await w.settle();
  return address;
}

describe("core worktrees (P4)", () => {
  test("colliding connection IDs and generations cannot pair another core's host with the lease", async () => {
    const original = await world();
    const replacement = await world();
    const { repo, hooks } = repository(replacement.root);
    await agentIn(replacement, repo);
    const host = hostOf(replacement, repo);
    expect(host.identity.id).toBe(original.lease().connectionId);
    expect(host.generation).toBe(original.lease().generation);
    await expect(
      createCoreWorktree(
        original.lease(),
        { topology: original.topology, host },
        { workspaceId: "hc:unplaced", branch: "wrong-core" },
      ),
    ).rejects.toBeInstanceOf(CoreOperationRefused);
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain(
      "wrong-core",
    );
    expect(hooks()).toBe("");
  });

  test("create makes a linked checkout as World's room, runs setup, and agents start in it", async () => {
    const w = await world();
    const { repo, hooks } = repository(w.root);
    await agentIn(w, repo);
    const host = hostOf(w, repo);
    const created = await createCoreWorktree(
      w.lease(),
      { topology: w.topology, host },
      { workspaceId: "hc:unplaced", branch: "feature-x" },
    );
    const checkout = join(w.root, "worktrees", "feature-x");
    expect(created).toMatchObject({
      label: "feature-x",
      checkout_path: checkout,
      branch: "feature-x",
      base_sync: { base: "HEAD" },
      setup_hook: { status: "succeeded" },
    });
    // Git made it, from the source's commit, on a new branch.
    expect(git(checkout, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "feature-x",
    );
    expect(git(checkout, "rev-parse", "HEAD")).toBe(
      git(repo, "rev-parse", "HEAD"),
    );
    expect(hooks()).toBe(`setup ${checkout}\n`);
    // The room carries the checkout in the TUI's workspace shape.
    const rows = await w.rows();
    expect(
      rows.workspaces.find((r) => r.workspace_id === created.workspace_id),
    ).toMatchObject({
      label: "feature-x",
      cwd: checkout,
      worktree: {
        checkout_path: checkout,
        repo_root: repo,
        branch: "feature-x",
        is_linked_worktree: true,
      },
    });
    // A shell started in the room runs in the checkout.
    const started = await launchCore(
      w.lease(),
      {
        workspaceId: created.workspace_id,
        kind: null,
        label: "Shell",
        text: "",
      },
      {
        topology: w.topology,
        resolveExecutable: async () => "/bin/sh",
      },
    );
    expect(started.status).toBe("started");
    const run = w.fake.calls.find((c) => c.method === "terminal.run");
    expect(run?.params).toMatchObject({ cwd: checkout });
    // Listed as open, so the room is reachable from the list.
    const listed = await listCoreWorktrees(
      w.lease(),
      { topology: w.topology, host },
      created.workspace_id,
    );
    expect(listed.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: checkout,
          branch: "feature-x",
          open: true,
          workspace_id: created.workspace_id,
        }),
        expect.objectContaining({ path: repo, branch: "main" }),
      ]),
    );
  });

  test("open makes an existing worktree a room once; its opened hook runs once", async () => {
    const w = await world();
    const { repo, hooks } = repository(w.root);
    await agentIn(w, repo);
    const other = join(w.root, "elsewhere");
    git(repo, "worktree", "add", "-q", "-b", "fix-y", other);
    const host = hostOf(w, repo);
    const deps = { topology: w.topology, host };
    const first = await openCoreWorktree(w.lease(), deps, {
      workspaceId: "hc:unplaced",
      path: other,
    });
    expect(first).toMatchObject({
      label: "fix-y",
      checkout_path: other,
      opened_hook: { status: "succeeded" },
    });
    expect(first).not.toHaveProperty("already_open");
    const again = await openCoreWorktree(w.lease(), deps, {
      workspaceId: "hc:unplaced",
      path: other,
    });
    expect(again).toMatchObject({
      workspace_id: first.workspace_id,
      already_open: true,
      opened_hook: { status: "skipped" },
    });
    expect(hooks()).toBe(`opened ${other}\n`);
    // Only what Git lists for the repository opens.
    await expect(
      openCoreWorktree(w.lease(), deps, {
        workspaceId: "hc:unplaced",
        path: join(w.root, "not-a-worktree"),
      }),
    ).rejects.toThrow("Git does not list that worktree");
  });

  test("remove asks first for its terminals, then teardown, end, git remove, close, removed", async () => {
    const w = await world();
    const { repo, hooks } = repository(w.root);
    await agentIn(w, repo);
    const host = hostOf(w, repo);
    const deps = { topology: w.topology, host };
    const created = await createCoreWorktree(w.lease(), deps, {
      workspaceId: "hc:unplaced",
      branch: "feature-z",
    });
    await launchCore(
      w.lease(),
      {
        workspaceId: created.workspace_id,
        kind: null,
        label: "Shell",
        text: "",
      },
      { topology: w.topology, resolveExecutable: async () => "/bin/sh" },
    );
    await w.settle();
    const inRoom = (await w.rows()).panes.filter(
      (p) => p.workspace_id === created.workspace_id,
    );
    expect(inRoom).toHaveLength(1);
    // Without a confirmation nothing runs and nothing ends.
    await expect(
      removeCoreWorktree(w.lease(), deps, {
        workspaceId: created.workspace_id,
        force: false,
        confirmation: null,
      }),
    ).rejects.toThrow("Confirm which terminals end");
    const plan = await planCoreKill(w.lease(), [inRoom[0]!.pane_id]);
    // A confirmation that no longer matches (a child started since) is
    // refused with the new plan, before the teardown hook.
    w.fake.create({
      name: "child",
      parent: inRoom[0]!.pane_id,
      die_with_parent: true,
    });
    await w.settle();
    const stale = await removeCoreWorktree(w.lease(), deps, {
      workspaceId: created.workspace_id,
      force: false,
      confirmation: confirmAll(plan),
    }).catch((error) => error);
    expect(stale).toBeInstanceOf(CoreOperationRefused);
    // The child shows in its parent's room, so the room now ends two.
    const now = (stale as CoreOperationRefused).plan!;
    expect([...now.roots, ...now.descendants]).toHaveLength(2);
    expect(hooks()).not.toContain("teardown");
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
    const fresh = await planCoreKill(
      w.lease(),
      (await w.rows()).panes
        .filter((p) => p.workspace_id === created.workspace_id)
        .map((p) => p.pane_id),
    );
    const removed = await removeCoreWorktree(w.lease(), deps, {
      workspaceId: created.workspace_id,
      force: false,
      confirmation: confirmAll(fresh),
    });
    expect(removed).toMatchObject({
      ok: true,
      checkout_path: created.checkout_path,
      killed: expect.arrayContaining([inRoom[0]!.pane_id]),
      before_remove_hook: { status: "succeeded" },
      removed_hook: { status: "succeeded" },
    });
    expect(existsSync(created.checkout_path)).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain("feature-z");
    expect(
      (await w.rows()).workspaces.some(
        (r) => r.workspace_id === created.workspace_id,
      ),
    ).toBe(false);
    expect(hooks().trim().split("\n")).toEqual([
      `setup ${created.checkout_path}`,
      `teardown ${created.checkout_path}`,
      `removed ${created.checkout_path}`,
    ]);
  });

  test("worktree removal retains core's report of an unconfirmed late cascade", async () => {
    const w = await world();
    const { repo } = repository(w.root);
    await agentIn(w, repo);
    const host = hostOf(w, repo),
      deps = { topology: w.topology, host };
    const created = await createCoreWorktree(w.lease(), deps, {
      workspaceId: "hc:unplaced",
      branch: "late-cascade",
    });
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
    if (shell.status !== "started") throw new Error("No shell");
    await w.settle();
    const plan = await planCoreKill(w.lease(), [shell.terminal_id]);
    let late = "";
    w.fake.onCall = (method) => {
      if (method === "terminal.kill" && !late)
        late = w.fake.create({
          parent: shell.terminal_id,
          die_with_parent: true,
          name: "late",
        });
    };
    const removed = await removeCoreWorktree(w.lease(), deps, {
      workspaceId: created.workspace_id,
      force: false,
      confirmation: confirmAll(plan),
    });
    expect(removed).toMatchObject({
      ok: true,
      alsoEnded: [{ address: late, name: "late", remote: false }],
    });
  });

  test("a terminal entering an empty worktree during teardown keeps its checkout", async () => {
    const w = await world();
    const { repo } = repository(w.root);
    await agentIn(w, repo);
    const host = hostOf(w, repo);
    const created = await createCoreWorktree(
      w.lease(),
      { topology: w.topology, host },
      { workspaceId: "hc:unplaced", branch: "race" },
    );
    const deps = {
      topology: w.topology,
      host: {
        ...host,
        worktreeHooks: {
          ...host.worktreeHooks,
          runWorktreeHook: async (
            params: Parameters<typeof host.worktreeHooks.runWorktreeHook>[0],
          ) => {
            const result = await host.worktreeHooks.runWorktreeHook(params);
            if (params.hook === "teardown") {
              await launchCore(
                w.lease(),
                {
                  workspaceId: created.workspace_id,
                  kind: null,
                  label: "New shell",
                  text: "",
                },
                {
                  topology: w.topology,
                  resolveExecutable: async () => "/bin/sh",
                },
              );
              await w.settle();
            }
            return result;
          },
        },
      },
    };
    await expect(
      removeCoreWorktree(w.lease(), deps, {
        workspaceId: created.workspace_id,
        force: false,
        confirmation: null,
      }),
    ).rejects.toThrow();
    expect(existsSync(created.checkout_path)).toBe(true);
    expect(w.fake.calls.filter((c) => c.method === "terminal.kill")).toEqual(
      [],
    );
  });

  test("a failed teardown hook ends and removes nothing", async () => {
    const w = await world();
    const { repo } = repository(w.root, { teardown: "exit 3" });
    await agentIn(w, repo);
    const deps = { topology: w.topology, host: hostOf(w, repo) };
    const created = await createCoreWorktree(w.lease(), deps, {
      workspaceId: "hc:unplaced",
      branch: "keep-me",
    });
    const result = await removeCoreWorktree(w.lease(), deps, {
      workspaceId: created.workspace_id,
      force: false,
      confirmation: null,
    });
    expect(result).toMatchObject({
      ok: false,
      skipped_remove: true,
      before_remove_hook: { status: "failed", exit_code: 3 },
    });
    expect(existsSync(created.checkout_path)).toBe(true);
    expect(
      (await w.rows()).workspaces.some(
        (r) => r.workspace_id === created.workspace_id,
      ),
    ).toBe(true);
  });

  test("the repository's own checkout and other rooms are not removable as worktrees", async () => {
    const w = await world();
    const { repo } = repository(w.root);
    await agentIn(w, repo);
    const deps = { topology: w.topology, host: hostOf(w, repo) };
    const main = await openCoreWorktree(w.lease(), deps, {
      workspaceId: "hc:unplaced",
      path: repo,
    });
    await expect(
      removeCoreWorktree(w.lease(), deps, {
        workspaceId: main.workspace_id,
        force: false,
        confirmation: null,
      }),
    ).rejects.toThrow("repository's own checkout");
    await expect(
      removeCoreWorktree(w.lease(), deps, {
        workspaceId: "hc:unplaced",
        force: false,
        confirmation: null,
      }),
    ).rejects.toThrow("not a worktree World opened");
    expect(existsSync(repo)).toBe(true);
  });

  test("a retired lease stops between steps: no room, no hook after a reconnect", async () => {
    const w = await world();
    const { repo, hooks } = repository(w.root);
    await agentIn(w, repo);
    const lease = w.lease();
    const host = hostOf(w, repo);
    w.fake.kill(w.socket);
    await until(() => !lease.isCurrent());
    await expect(
      createCoreWorktree(
        lease,
        { topology: w.topology, host },
        { workspaceId: "hc:unplaced", branch: "late" },
      ),
    ).rejects.toThrow("reconnected");
    expect(git(repo, "branch", "--list", "late")).toBe("");
    expect(hooks()).toBe("");
    expect(w.topology.get(lease.runtime.core.epoch!.coreId).rooms).toEqual([]);
  });

  test("a branch name with shell syntax is refused before Git runs", async () => {
    const w = await world();
    const { repo } = repository(w.root);
    await agentIn(w, repo);
    const deps = { topology: w.topology, host: hostOf(w, repo) };
    await expect(
      createCoreWorktree(w.lease(), deps, {
        workspaceId: "hc:unplaced",
        branch: "x; rm -rf ~",
      }),
    ).rejects.toThrow("shell syntax");
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  });
});
