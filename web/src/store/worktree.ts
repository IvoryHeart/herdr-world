import { type Notice } from "./types";
import { DEFAULT_NOTICE_AUTO_DISMISS_MS } from "./notifications";

type WorktreeHookEvent =
  | "worktree.created"
  | "worktree.opened"
  | "worktree.before_remove"
  | "worktree.removed";

type WorktreeHookRunResult = {
  event: WorktreeHookEvent;
  status: "skipped" | "succeeded" | "failed";
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

type WorktreeRemovalCleanup = {
  terminated_processes?: number;
  recovered_stale_checkout?: boolean;
  preserved_path?: string;
  warning?: string;
};
export const WORKTREE_REMOVED_EVENT = "herdr-world:worktree-removed";

function hookEventLabel(event: WorktreeHookEvent): string {
  switch (event) {
    case "worktree.before_remove":
      return "Worktree teardown hook";
    case "worktree.opened":
      return "Worktree opened hook";
    case "worktree.removed":
      return "Worktree removed hook";
    case "worktree.created":
      return "Worktree setup hook";
  }
}

function hookOutput(
  result: Pick<WorktreeHookRunResult, "stdout" | "stderr" | "error">,
) {
  return [result.stderr, result.stdout, result.error]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join("\n")
    .trim();
}

export function summarizeDirectHookResult(
  result: WorktreeHookRunResult,
): Notice | null {
  if (result.status === "skipped") return null;
  const output = hookOutput(result);
  const exitSuffix =
    typeof result.exit_code === "number" ? ` (exit ${result.exit_code})` : "";
  return {
    kind: result.status === "succeeded" ? "success" : "error",
    message:
      result.status === "succeeded"
        ? `${hookEventLabel(result.event)} completed`
        : `${hookEventLabel(result.event)} failed${exitSuffix}`,
    detail: output ? output.slice(0, 1400) : undefined,
    detailMode: output ? "output" : undefined,
    detailTitle: output ? `${hookEventLabel(result.event)} output` : undefined,
    ...(result.status === "succeeded"
      ? { autoDismissMs: DEFAULT_NOTICE_AUTO_DISMISS_MS }
      : {}),
  };
}

export function worktreeRemovalCompletionNotice(
  cleanup: WorktreeRemovalCleanup | undefined,
  removedHookNotice: Notice | null,
): Notice | null {
  if (!cleanup?.recovered_stale_checkout && !cleanup?.warning) {
    return removedHookNotice;
  }

  const stopped = Number(cleanup.terminated_processes ?? 0);
  const recoveryDetails = [
    stopped > 0
      ? `Stopped ${stopped} process${stopped === 1 ? "" : "es"} still using the checkout.`
      : "",
    cleanup.preserved_path
      ? `Stale files were preserved at ${cleanup.preserved_path}.`
      : cleanup.recovered_stale_checkout
        ? "The checkout was already absent; stale Herdr state was reconciled."
        : "",
    cleanup.warning ?? "",
  ].filter(Boolean);

  if (removedHookNotice) {
    const cleanupWarning = Boolean(cleanup.warning);
    return {
      ...removedHookNotice,
      kind: cleanupWarning ? "error" : removedHookNotice.kind,
      message:
        cleanupWarning && removedHookNotice.kind !== "error"
          ? "Worktree removed with cleanup warning"
          : removedHookNotice.message,
      detail: [
        cleanupWarning && removedHookNotice.kind !== "error"
          ? removedHookNotice.message
          : "",
        removedHookNotice.detail,
        ...recoveryDetails,
      ]
        .filter(Boolean)
        .join("\n"),
      detailTitle:
        removedHookNotice.detail || cleanupWarning
          ? "Worktree removal details"
          : undefined,
    };
  }

  return {
    kind: cleanup.warning ? "error" : "success",
    message: cleanup.warning
      ? "Worktree removed with cleanup warning"
      : "Worktree removed",
    detail: recoveryDetails.join("\n"),
  };
}
export { type WorktreeHookRunResult, type WorktreeRemovalCleanup };
