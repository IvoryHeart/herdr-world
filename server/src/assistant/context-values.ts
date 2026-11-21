import { createHash } from "node:crypto";
import { isRecord } from "../agent/session-utils";
import { validateConnectionId } from "../connections/protocol";
import { sanitizeExplorerPath } from "../workspace/file-paths";
export function workspaceIdentity(workspace: Record<string, unknown>): string {
  const worktree = isRecord(workspace.worktree) ? workspace.worktree : {};
  return createHash("sha256")
    .update(
      JSON.stringify([
        workspace.cwd ?? null,
        worktree.repo_key ?? null,
        worktree.repo_root ?? null,
        worktree.checkout_path ?? null,
      ]),
    )
    .digest("hex");
}

export function identifier(value: unknown, name: string): string {
  try {
    return validateConnectionId(value);
  } catch {
    throw new Error(`Invalid ${name}`);
  }
}

export function limitedText(value: unknown, limit = 200): string {
  if (typeof value !== "string") return "";
  return value.length > limit ? `${value.slice(0, limit)} [truncated]` : value;
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function relativePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /^[\\/:]|^[a-z]:/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Diff path must be a relative workspace path");
  }
  const path = sanitizeExplorerPath(value);
  if (!path) throw new Error("Diff path must be a relative workspace path");
  return path;
}
