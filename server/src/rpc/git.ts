import { sanitizeConnectionError } from "../connections/manager";
import { createWorkspaceWorktree } from "../worktree/create";
import {
  removeWorktreeWithRecovery,
  WORKTREE_REMOVE_TIMEOUT_MS,
} from "../worktree/remove";
import type { ConnectionRpcContext } from "./context";

/** Git and worktree methods on one connection (git.*, worktree.*). */
export function handleGitRpc(
  rpc: ConnectionRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (
    !(
      method === "git.diff_summary" ||
      method === "git.pull_request" ||
      method === "git.diff_file" ||
      method === "git.commits" ||
      method === "git.commit" ||
      method === "git.commit_file" ||
      method === "git.commit_preview" ||
      method === "git.pull" ||
      method === "git.file_action" ||
      method === "git.repo_action" ||
      method === "worktree.create" ||
      method === "worktree.open" ||
      method === "worktree.remove"
    )
  )
    return false;
  return dispatchGitRpc(rpc);
}

async function dispatchGitRpc(
  rpc: ConnectionRpcContext,
): Promise<false | void> {
  const {
    connectionId,
    id,
    method,
    params,
    requestIsCurrent,
    sendError,
    sendReply,
    ws,
    connection,
  } = rpc;
  const { logger, markRpcError } = rpc.services;
  const {
    herdr,
    worktreeParents,
    worktreeRemovalCoordinator,
    worktreeRemovalRuntime,
  } = connection;
  const {
    readGitCommit,
    readGitCommitFile,
    readGitCommitPreview,
    readGitCommits,
    readGitDiffFile,
    readGitDiffSummary,
    readWorkspacePullRequest,
    runGitPull,
    runWorkspaceGitFileAction,
    runWorkspaceGitRepoAction,
  } = connection.files;
  const { invalidateGitStatus } = connection.status;
  const {
    runWorktreeHook,
    runWorktreeOpenedHook,
    runWorktreeRemovedHook,
    sourceWorkspaceForWorktreeCreate,
    worktreeRemoveHookContext,
  } = connection.worktreeHooks;
  if (method === "git.diff_summary") {
    try {
      const result = await readGitDiffSummary(params ?? {});
      sendReply({ id, result }, "git-diff-summary");
    } catch (e) {
      sendError("git-diff-summary-error", e);
    }
    return;
  }
  if (method === "git.pull_request") {
    try {
      const result = await readWorkspacePullRequest(params ?? {});
      sendReply({ id, result }, "git-pull-request");
    } catch {
      // Root resolution errors may include remote URLs or CLI diagnostics.
      sendError(
        "git-pull-request-error",
        new Error("Cannot resolve this workspace's Git checkout."),
      );
    }
    return;
  }
  if (method === "git.diff_file") {
    try {
      const result = await readGitDiffFile(params ?? {});
      sendReply({ id, result }, "git-diff-file");
    } catch (e) {
      sendError("git-diff-file-error", e);
    }
    return;
  }
  if (
    method === "git.commits" ||
    method === "git.commit" ||
    method === "git.commit_file" ||
    method === "git.commit_preview"
  ) {
    try {
      const result =
        method === "git.commits"
          ? await readGitCommits(params ?? {})
          : method === "git.commit"
            ? await readGitCommit(params ?? {})
            : method === "git.commit_file"
              ? await readGitCommitFile(params ?? {})
              : await readGitCommitPreview(params ?? {});
      sendReply({ id, result }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "git.pull") {
    try {
      const result = await runGitPull(params ?? {});
      invalidateGitStatus(result.root);
      sendReply({ id, result }, "git-pull");
    } catch (e) {
      sendError("git-pull-error", e);
    }
    return;
  }
  if (method === "git.file_action") {
    try {
      const result = await runWorkspaceGitFileAction(params ?? {});
      invalidateGitStatus(result.root);
      sendReply({ id, result }, "git-file-action");
    } catch (e) {
      sendError("git-file-action-error", e);
    }
    return;
  }
  if (method === "git.repo_action") {
    try {
      const result = await runWorkspaceGitRepoAction(params ?? {});
      invalidateGitStatus(result.root);
      sendReply({ id, result }, "git-repo-action");
    } catch (e) {
      sendError("git-repo-action-error", e);
    }
    return;
  }
  if (method === "worktree.create") {
    try {
      const result = await createWorkspaceWorktree(
        connection,
        params ?? {},
        requestIsCurrent,
        (error) => {
          if (!requestIsCurrent()) return;
          logger.warn("unable to persist worktree parent", {
            connection: connectionId,
            error: sanitizeConnectionError(error),
          });
        },
      );
      sendReply(
        {
          id,
          result,
        },
        "worktree-create",
      );
    } catch (e) {
      sendError("worktree-create-error", e);
    }
    return;
  }
  if (method === "worktree.open") {
    try {
      const workspaceId = String(params?.workspace_id ?? "");
      const sourceWorkspace = await sourceWorkspaceForWorktreeCreate(
        params ?? {},
      );
      const result = await herdr.call(method, params ?? {});
      await worktreeParents
        .rememberWorktreeParent(result, workspaceId, requestIsCurrent)
        .catch((error) => {
          if (!requestIsCurrent()) return;
          logger.warn("unable to persist opened worktree parent", {
            connection: connectionId,
            error: sanitizeConnectionError(error),
          });
        });
      const openedHook = await runWorktreeOpenedHook(result, sourceWorkspace);
      sendReply(
        {
          id,
          result: { ...result, opened_hook: openedHook },
        },
        "worktree-open",
      );
    } catch (e) {
      sendError("worktree-open-error", e);
    }
    return;
  }
  if (method === "worktree.remove") {
    try {
      const workspaceId = String(params?.workspace_id ?? "");
      const result = await worktreeRemovalCoordinator.run(
        workspaceId,
        async () => {
          const removeHookContext = await worktreeRemoveHookContext(
            params ?? {},
          );
          const checkoutState = removeHookContext
            ? await worktreeRemovalRuntime
                .inspectCheckout(removeHookContext.checkoutPath)
                .catch(() => "unknown" as const)
            : "unknown";
          const beforeRemoveHook =
            removeHookContext && checkoutState !== "missing"
              ? await runWorktreeHook({
                  hook: "teardown",
                  checkoutPath: removeHookContext.checkoutPath,
                  sourceCheckoutPath: removeHookContext.sourceCheckoutPath,
                  repoSettingsKey: removeHookContext.repoSettingsKey,
                })
              : ({
                  event: "worktree.before_remove",
                  status: "skipped",
                } as const);
          if (beforeRemoveHook.status === "failed") {
            markRpcError(
              ws,
              id,
              beforeRemoveHook.error || "before-remove hook failed",
            );
            return {
              ok: false,
              skipped_remove: true,
              before_remove_hook: beforeRemoveHook,
            };
          }

          const removal = await removeWorktreeWithRecovery({
            call: (name, callParams) =>
              herdr.call(name, callParams, WORKTREE_REMOVE_TIMEOUT_MS),
            params: params ?? {},
            checkoutPath: removeHookContext?.checkoutPath,
            runtime: worktreeRemovalRuntime,
          });
          if (removal.cleanup?.preserved_path) {
            logger.warn("preserved stale worktree files", {
              connection: connectionId,
              path: removal.cleanup.preserved_path,
            });
          }
          if (removeHookContext?.checkoutPath) {
            await worktreeParents
              .forgetWorktree(removeHookContext.checkoutPath, requestIsCurrent)
              .catch((error) => {
                if (!requestIsCurrent()) return;
                logger.warn("unable to remove worktree parent", {
                  connection: connectionId,
                  error: sanitizeConnectionError(error),
                });
              });
          }
          const removedHook = await runWorktreeRemovedHook(removeHookContext);
          return {
            ...removal.result,
            ...(removal.cleanup ? { cleanup: removal.cleanup } : {}),
            before_remove_hook: beforeRemoveHook,
            removed_hook: removedHook,
          };
        },
      );
      sendReply({ id, result }, "worktree-remove");
    } catch (e) {
      sendError("worktree-remove-error", e);
    }
    return;
  }
  return false;
}
