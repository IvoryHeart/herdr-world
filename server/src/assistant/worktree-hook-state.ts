import {
  workspaceRepoSettingsKey,
  worktreeCommandFor,
} from "../config/gui-settings";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { checkoutPath } from "../workspace/utils";

/**
 * What creating a worktree from this workspace will run, read from the owning
 * runtime: the repository's setup hook and whether hooks are enabled, its
 * worktree location and the configured worktree command. Ranger previews
 * these and refuses to dispatch if any of them changed.
 */
export async function readWorktreeHookState(
  runtime: Pick<
    LegacyConnectionRuntime,
    "worktreeHooks" | "readSettings" | "sshHost"
  >,
  read: <T>(operation: () => Promise<T>) => Promise<T>,
  connectionId: string,
  current: Record<string, unknown>,
  root: string,
) {
  const source = { ...current, cwd: checkoutPath(current) || root };
  const hooks = await read(() =>
    runtime.worktreeHooks.readWorktreeHooks(source.cwd),
  );
  const command = hooks?.config.setup ?? null;
  if (
    command !== null &&
    (typeof command !== "string" || command.length > 20_000)
  )
    throw new Error("Cannot preview this setup hook");
  const key = workspaceRepoSettingsKey(source, runtime.sshHost(), connectionId);
  const enabled = await read(() => runtime.worktreeHooks.hooksEnabled(key));
  // The repository's worktree location decides the new checkout's path,
  // and the configured command, if any, creates it instead of Herdr. Both
  // come from the owning runtime's settings, read once.
  const settings = await read(() => runtime.readSettings());
  const directory =
    (key ? settings.repositories[key]?.worktree_directory : undefined) ?? null;
  const worktreeCommand = worktreeCommandFor(settings, key) ?? null;
  return { command, enabled, directory, worktreeCommand };
}
