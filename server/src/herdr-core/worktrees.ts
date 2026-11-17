import type { ReadyRuntimeLease } from "../connections/manager";
import {
  type GuiSettings,
  repoSettingsKey,
  worktreeCommandFor,
  worktreeRemoveCommandFor,
} from "../config/gui-settings";
import { shQuote } from "../utils/process-utils";
import {
  herdrDefaultCheckoutPath,
  syncWorktreeBase,
  WORKTREE_COMMAND_TIMEOUT_MS,
  worktreeCheckoutPath,
} from "../worktree/create";
import {
  missingWorktreeCommand,
  validateWorktreeBranchName,
  worktreeCommandScript,
  worktreeShellArgv,
} from "../worktree/command-template";
import {
  runWorktreeRemoveCommand,
  WORKTREE_REMOVE_TIMEOUT_MS,
} from "../worktree/remove";
import type {
  WorktreeHookExpectation,
  WorktreeHookRunResult,
} from "../worktree/worktree-hooks";
import type { CoreHostRuntime } from "./host-runtime";
import type { CoreKillConfirmation } from "./kill-plan";
import type { CoreTopologyPort } from "./layout";
import {
  assertCoreKillConfirmed,
  coreCheckoutOf,
  coreCheckoutRoom,
  CoreOperationRefused,
  coreRoomTerminals,
  dropCoreRoom,
  killCore,
} from "./operations";
import type { CoreConnectionRuntime } from "./runtime";
import { coreRoomWorkspaceId } from "./topology";

type Lease = ReadyRuntimeLease<CoreConnectionRuntime>;

/**
 * Git worktrees for herdr-core rooms (P4). Herdr's TUI makes a worktree a
 * workspace; core has none, so World makes it one of its own rooms (M1)
 * whose folder is the checkout: agents started there run in it, and its
 * Files, Changes and hooks use it. Git runs on the core's host through
 * World's helpers, with the same repository settings (worktree location,
 * worktree commands, Paseo hooks) as a Herdr connection's.
 *
 * Every step runs under the lease it was admitted with: a reconnect stops
 * the operation between steps and nothing more is done.
 */
export type CoreWorktreeDeps = {
  topology: CoreTopologyPort;
  host: CoreHostRuntime;
};

const CHANGED =
  "The host's herdr-core reconnected; nothing more was done. Look again and retry.";

function guard(
  lease: Lease,
  host: CoreHostRuntime,
  authorized?: () => boolean,
) {
  if (host.remotePlatform === "windows")
    throw new CoreOperationRefused(
      "Worktrees need a Unix host; this herdr-core runs on Windows.",
    );
  const current = () => {
    if (
      !lease.isCurrent() ||
      !host.lease.isCurrent() ||
      host.identity.id !== lease.connectionId ||
      host.lease.runtime !== lease.runtime ||
      host.generation !== lease.generation ||
      (authorized && !authorized())
    )
      throw new CoreOperationRefused(CHANGED);
  };
  current();
  const run: CoreHostRuntime["runProcessWithCodeTimeout"] = async (
    argv,
    ...rest
  ) => {
    current();
    const result = await host.runProcessWithCodeTimeout(argv, ...rest);
    current();
    return result;
  };
  return { current, run };
}

/** The repository a folder belongs to: its main checkout (Herdr's repo_root). */
export async function repositoryOf(host: CoreHostRuntime, folder: string) {
  const root = await host.worktreeGit.inspect(folder);
  if (!root)
    throw new CoreOperationRefused(`${folder} is not in a Git repository.`);
  const main = root.gitCommonDir.endsWith("/.git")
    ? root.gitCommonDir.slice(0, -"/.git".length)
    : root.canonicalRoot;
  return { root: root.canonicalRoot, main, branch: root.branch };
}

function settingsKey(host: CoreHostRuntime, repository: string) {
  return repoSettingsKey(repository, host.sshHost(), host.identity.id);
}

function lastLinePath(stdout: string, what: string): string {
  const path = stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!path.startsWith("/") || /[\0\r]/.test(path) || path.length > 4096)
    throw new Error(`${what} left no checkout at its path.`);
  return path;
}

export type CoreWorktreeCreated = {
  workspace_id: string;
  label: string;
  checkout_path: string;
  branch: string;
  base_sync: Awaited<ReturnType<typeof syncWorktreeBase>>;
  setup_hook: WorktreeHookRunResult;
  command_fallback?: string;
};

/**
 * A new linked worktree from origin's freshly fetched default branch (or
 * the checked-out commit without an origin), as World's room. Made with the
 * repository's worktree command when one is set and installed, else `git
 * worktree add` at the configured worktree location (Herdr's default path
 * otherwise). The setup hook then runs in it.
 */
export async function createCoreWorktree(
  lease: Lease,
  deps: CoreWorktreeDeps,
  request: {
    workspaceId: string;
    branch: string;
    isAuthorized?: () => boolean;
    expectedSetup?: WorktreeHookExpectation;
    expectedWorktree?: { directory: string | null; command: string | null };
  },
): Promise<CoreWorktreeCreated> {
  const { host } = deps;
  const { current, run } = guard(lease, host, request.isAuthorized);
  const branch = request.branch.trim();
  try {
    validateWorktreeBranchName(branch);
  } catch (error) {
    throw new CoreOperationRefused((error as Error).message);
  }
  const baseSync = await syncWorktreeBase({
    workspaceId: request.workspaceId,
    resolveGitRoot: async (id) => {
      const resolved = await host.files.resolveWorkspaceGitRoot({
        workspace_id: id,
      });
      current();
      return resolved;
    },
    host: host.sshHost(),
    shQuote,
    runProcessWithCodeTimeout: run,
  });
  const repository = await repositoryOf(host, baseSync.root);
  current();
  const key = settingsKey(host, repository.main);
  const settings: GuiSettings = await host.readSettings();
  const repoName = repository.main.split("/").pop() || "repo";
  const directory = key
    ? settings.repositories[key]?.worktree_directory
    : undefined;
  const path = directory
    ? worktreeCheckoutPath(directory, branch)
    : herdrDefaultCheckoutPath(repoName, branch);
  const command = worktreeCommandFor(settings, key);
  if (
    request.expectedWorktree &&
    (request.expectedWorktree.directory !== (directory ?? null) ||
      request.expectedWorktree.command !== (command ?? null))
  )
    throw new CoreOperationRefused(
      "The worktree location or command changed; prepare a new preview.",
    );
  const fallback = command
    ? await missingWorktreeCommand({
        template: command,
        host: host.sshHost(),
        runProcess: run,
      })
    : null;
  // The checkout's absolute path, `~` resolved on its host, is the last line.
  let script: string;
  if (command && !fallback) {
    const rendered = worktreeCommandScript(command, {
      path,
      branch,
      base: baseSync.commit,
      repo: baseSync.root,
    });
    script = `${rendered.exports}; cd "$ROAMGATE_WORKTREE_REPO" && ${rendered.command} && cd "$ROAMGATE_WORKTREE_PATH" && printf '\\n%s\\n' "$(pwd -P)"`;
  } else {
    script = [
      "set -e",
      `p=${shQuote(path)}`,
      'case "$p" in "~/"*) p="$HOME/${p#"~/"}" ;; esac',
      'mkdir -p "$(dirname "$p")"',
      `GIT_TERMINAL_PROMPT=0 git -C ${shQuote(baseSync.root)} worktree add -b ${shQuote(branch)} "$p" ${shQuote(baseSync.commit)} >&2`,
      `cd "$p" && printf '\\n%s\\n' "$(pwd -P)"`,
    ].join("\n");
  }
  const made = await run(
    worktreeShellArgv(host.sshHost(), script),
    WORKTREE_COMMAND_TIMEOUT_MS,
  );
  if (made.code !== 0) {
    const output = (made.stderr.trim() || made.stdout.trim()).slice(-2000);
    throw new Error(
      `${command && !fallback ? "Worktree command" : "git worktree add"} failed (exit ${made.code})${output ? `: ${output}` : "."}`,
    );
  }
  const created = lastLinePath(
    made.stdout,
    command && !fallback ? "The worktree command" : "git worktree add",
  );
  current();
  const room = await coreCheckoutRoom(
    lease,
    deps.topology,
    { path: created, source: repository.main, branch },
    branch,
  );
  if (!room.opened)
    throw new CoreOperationRefused(
      `${created} is already a room; its setup hook was not run again.`,
    );
  const setup = await host.worktreeHooks.runWorktreeHook({
    hook: "setup",
    expected: request.expectedSetup,
    checkoutPath: created,
    sourceCheckoutPath: baseSync.root,
    repoSettingsKey: key,
    isCurrent: () =>
      lease.isCurrent() && (!request.isAuthorized || request.isAuthorized()),
  });
  return {
    workspace_id: room.workspace_id,
    label: room.label,
    checkout_path: created,
    branch,
    base_sync: baseSync,
    setup_hook: setup,
    ...(fallback
      ? { command_fallback: `${fallback} World created it with git.` }
      : {}),
  };
}

/** The worktrees of a room's repository, as Git lists them on the core's host. */
export async function listCoreWorktrees(
  lease: Lease,
  deps: CoreWorktreeDeps,
  workspaceId: string,
) {
  const { current } = guard(lease, deps.host);
  const { worktrees = [] } = await deps.host.resources.listWorktrees({
    workspace_id: workspaceId,
  });
  current();
  const rooms = new Map(
    deps.topology
      .get(lease.runtime.core.epoch?.coreId ?? "")
      .rooms.flatMap((room) =>
        room.checkout ? [[room.checkout.path, room.id] as const] : [],
      ),
  );
  return {
    worktrees: worktrees.map((entry) => ({
      ...entry,
      ...(rooms.has(entry.path)
        ? {
            open: true,
            workspace_id: coreRoomWorkspaceId({ id: rooms.get(entry.path)! }),
          }
        : {}),
    })),
  };
}

/**
 * Opens a worktree Git lists for the room's repository as World's room
 * (the repository's own checkout too). An already open one is returned as
 * it is, and its `opened` hook does not run again.
 */
export async function openCoreWorktree(
  lease: Lease,
  deps: CoreWorktreeDeps,
  request: { workspaceId: string; path: string },
) {
  const { host } = deps;
  const { current } = guard(lease, host);
  const { worktrees = [] } = await host.resources.listWorktrees({
    workspace_id: request.workspaceId,
  });
  current();
  const listed = worktrees.find(
    (entry) => entry.path === request.path && !entry.is_bare,
  );
  if (!listed)
    throw new CoreOperationRefused(
      "Git does not list that worktree for this repository.",
    );
  if (listed.is_prunable)
    throw new CoreOperationRefused(
      "That worktree's folder is missing; prune it with Git first.",
    );
  const repository = await repositoryOf(host, listed.path);
  current();
  const branch =
    typeof listed.branch === "string" && listed.branch
      ? listed.branch
      : undefined;
  const room = await coreCheckoutRoom(
    lease,
    deps.topology,
    {
      path: listed.path,
      source: repository.main,
      ...(branch ? { branch } : {}),
    },
    branch ?? listed.path.split("/").pop() ?? "Worktree",
  );
  const opened: WorktreeHookRunResult =
    room.opened && listed.path !== repository.main
      ? await host.worktreeHooks.runWorktreeHook({
          hook: "opened",
          checkoutPath: listed.path,
          sourceCheckoutPath: repository.main,
          repoSettingsKey: settingsKey(host, repository.main),
          isCurrent: () => lease.isCurrent(),
        })
      : { event: "worktree.opened", status: "skipped" };
  return {
    workspace_id: room.workspace_id,
    label: room.label,
    checkout_path: listed.path,
    ...(room.opened ? {} : { already_open: true }),
    opened_hook: opened,
  };
}

export type CoreWorktreeRemoved =
  | {
      ok: true;
      checkout_path: string;
      killed: string[];
      alsoEnded?: Array<{
        address: string;
        name: string | null;
        remote: boolean;
      }>;
      before_remove_hook: WorktreeHookRunResult;
      removed_hook: WorktreeHookRunResult;
      command_fallback?: string;
    }
  | {
      ok: false;
      skipped_remove: true;
      checkout_path: string;
      killed: string[];
      alsoEnded?: Array<{
        address: string;
        name: string | null;
        remote: boolean;
      }>;
      uncertain?: string[];
      before_remove_hook: WorktreeHookRunResult;
      message: string;
    };

/**
 * Removes a worktree room's linked checkout. The terminals the room shows
 * (and every child core ends with them, M7) must be confirmed first, as
 * when closing the room. Order: teardown hook (a failure stops here, with
 * nothing ended), then the confirmed terminals end, then the checkout is
 * removed (the remove command, else `git worktree remove`), then the room
 * closes and the `removed` hook runs. A failed removal keeps the room so
 * it can be retried.
 */
export async function removeCoreWorktree(
  lease: Lease,
  deps: CoreWorktreeDeps,
  request: {
    workspaceId: string;
    force: boolean;
    confirmation: CoreKillConfirmation | null;
  },
): Promise<CoreWorktreeRemoved> {
  const { host } = deps;
  const { current, run } = guard(lease, host);
  const target = coreCheckoutOf(lease, deps.topology, request.workspaceId);
  if (!target)
    throw new CoreOperationRefused("That room is not a worktree World opened.");
  const { checkout } = target;
  if (checkout.path === checkout.source)
    throw new CoreOperationRefused(
      "That room is the repository's own checkout; close the room instead.",
    );
  const terminals = await coreRoomTerminals(lease, request.workspaceId);
  if (terminals.length) {
    if (!request.confirmation)
      throw new CoreOperationRefused(
        "Confirm which terminals end with this worktree first.",
      );
    await assertCoreKillConfirmed(lease, terminals, request.confirmation);
  }
  current();
  const key = settingsKey(host, checkout.source);
  const teardown = await host.worktreeHooks.runWorktreeHook({
    hook: "teardown",
    checkoutPath: checkout.path,
    sourceCheckoutPath: checkout.source,
    cwdPath: checkout.path,
    repoSettingsKey: key,
    isCurrent: () => lease.isCurrent(),
  });
  if (teardown.status === "failed")
    return {
      ok: false,
      skipped_remove: true,
      checkout_path: checkout.path,
      killed: [],
      before_remove_hook: teardown,
      message:
        "The teardown hook failed; nothing was ended or removed. Fix or disable it, then retry.",
    };
  // Hooks are arbitrary asynchronous work: the room may have gained a
  // terminal while teardown ran, including when it was originally empty.
  current();
  const afterHook = await coreRoomTerminals(lease, request.workspaceId);
  if (afterHook.length) {
    if (!request.confirmation)
      throw new CoreOperationRefused(
        "The room gained terminals; confirm them before removing its checkout.",
      );
    await assertCoreKillConfirmed(lease, afterHook, request.confirmation);
  }
  const outcome =
    afterHook.length && request.confirmation
      ? await killCore(lease, afterHook, request.confirmation)
      : { killed: [], uncertain: [], alsoEnded: [] };
  if (outcome.uncertain.length)
    return {
      ok: false,
      skipped_remove: true,
      checkout_path: checkout.path,
      killed: outcome.killed,
      alsoEnded: outcome.alsoEnded,
      uncertain: outcome.uncertain,
      before_remove_hook: teardown,
      message:
        "herdr-core did not confirm that every terminal ended; the checkout was kept. Look again and retry.",
    };
  current();
  const settings = await host.readSettings();
  const command = worktreeRemoveCommandFor(settings, key);
  const fallback = command
    ? await runWorktreeRemoveCommand({
        template: command,
        checkoutPath: checkout.path,
        sourceCheckoutPath: checkout.source,
        force: request.force,
        host: host.sshHost(),
        runProcess: run,
      })
    : null;
  if (!command || fallback) {
    const removed = await run(
      worktreeShellArgv(
        host.sshHost(),
        `GIT_TERMINAL_PROMPT=0 git -C ${shQuote(checkout.source)} worktree remove ${request.force ? "--force " : ""}${shQuote(checkout.path)}`,
      ),
      WORKTREE_REMOVE_TIMEOUT_MS,
    );
    if (removed.code !== 0) {
      const output = (removed.stderr.trim() || removed.stdout.trim()).slice(
        -2000,
      );
      throw new Error(
        `git worktree remove failed (exit ${removed.code})${output ? `: ${output}` : "."} The room was kept; its terminals ${outcome.killed.length ? "ended" : "were left as they were"}.`,
      );
    }
  }
  current();
  await dropCoreRoom(lease, deps.topology, target.roomId);
  current();
  const removedHook = await host.worktreeHooks.runWorktreeHook({
    hook: "removed",
    checkoutPath: checkout.path,
    sourceCheckoutPath: checkout.source,
    cwdPath: checkout.source,
    repoSettingsKey: key,
    isCurrent: () => lease.isCurrent(),
  });
  return {
    ok: true,
    checkout_path: checkout.path,
    killed: outcome.killed,
    alsoEnded: outcome.alsoEnded,
    before_remove_hook: teardown,
    removed_hook: removedHook,
    ...(fallback
      ? { command_fallback: `${fallback} World removed it with git.` }
      : {}),
  };
}
