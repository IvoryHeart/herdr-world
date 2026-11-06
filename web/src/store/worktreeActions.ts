import { type ConnectionClient } from "../api";
import { action, leaseSnapshot, setForConnection, state } from "../store";
import { refreshNow } from "./refresh";
import { adoptBrowserTarget, browserSelectionIsCurrent } from "./creation";
import { connectionSnapshot } from "./sessions";
import {
  summarizeDirectHookResult,
  type WorktreeHookRunResult,
} from "./worktree";

/** Save one repository's settings on its owning connection, then refresh. */
export function updateRepoSettings(
  key: string,
  settings: Record<string, unknown>,
) {
  return action(async (lease) => {
    const result = await lease.client.call("settings.update_repo", {
      key,
      settings,
    });
    await refreshNow(lease);
    return result;
  });
}

/**
 * Create a worktree from a workspace through its owning connection, with
 * progress, fallback and result notices.
 */
export function createWorktree(
  workspaceId: string,
  branch: string,
  client?: ConnectionClient,
) {
  const navigation = connectionSnapshot(
    state,
    client?.connectionId ?? state.activeConnectionId,
  ).browserNavigation;
  return action(
    async (lease) => {
      setForConnection(lease, {
        notice: {
          kind: "info",
          message: "Creating worktree",
          detail: `Updating origin's default branch before creating ${branch}.`,
          loading: true,
        },
      });
      const result = await lease.client.call(
        "worktree.create",
        {
          workspace_id: workspaceId,
          branch,
          focus: leaseSnapshot(lease).navigationMode !== "browser-local",
        },
        // A configured worktree command may run for minutes; the server
        // bounds it, and a disconnect still ends the wait.
        null,
      );
      if (browserSelectionIsCurrent(navigation, lease))
        adoptBrowserTarget(lease, result);
      const setupHook = result?.setup_hook as WorktreeHookRunResult | undefined;
      const setupNotice = setupHook
        ? summarizeDirectHookResult(setupHook)
        : null;
      const fallback =
        typeof result?.command_fallback === "string"
          ? result.command_fallback
          : null;
      if (setupNotice) {
        setForConnection(lease, { notice: setupNotice });
      } else if (fallback) {
        setForConnection(lease, {
          notice: {
            kind: "info",
            message: "Worktree created without the worktree command",
            detail: fallback,
          },
        });
      } else {
        const commit = String(result?.base_sync?.commit ?? "").slice(0, 12);
        const base = String(
          result?.base_sync?.base ?? "origin's default branch",
        );
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: "Worktree created",
            detail: commit
              ? `${branch} starts from ${base} at ${commit}.`
              : `${branch} starts from the latest ${base}.`,
            autoDismissMs: 5000,
          },
        });
      }
      return result;
    },
    {
      client,
      failureNotice: (error) => ({
        kind: "error",
        message: "Failed to create worktree",
        detail: error.message,
      }),
    },
  );
}
