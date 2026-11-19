import { useMemo, useSyncExternalStore } from "react";
import type { Pane, Workspace } from "../types";
import { worldRuntimeStore } from "./runtimeStore";

const RECENT_FOLDERS = 6;

/** A folder as World offers it again: absolute or ~/, no trailing slash. */
function folderOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const folder = value.trim();
  if (!folder || /[\x00-\x1f\x7f]/.test(folder)) return null;
  if (!folder.startsWith("/") && !/^~(?:\/|$)/.test(folder)) return null;
  return folder.length > 1 ? folder.replace(/\/+$/, "") || "/" : folder;
}

/**
 * The folders a connection's rooms and agents work in, most recently active
 * first: each pane's live folder, then each room's own (its checkout or
 * working directory), ranked by its latest pane. A focused pane counts as
 * the most recent; ties keep the host's order. At most six.
 */
export function recentFolders(
  rows: {
    workspaces?: readonly Pick<
      Workspace,
      "workspace_id" | "cwd" | "worktree"
    >[];
    panes?: readonly (Pick<Pane, "workspace_id" | "cwd"> &
      Partial<Pick<Pane, "foreground_cwd" | "focused" | "last_activity_at">>)[];
  } | null,
  limit = RECENT_FOLDERS,
): string[] {
  if (!rows) return [];
  const ranked = new Map<string, { at: number; order: number }>();
  let order = 0;
  const offer = (value: unknown, at: number) => {
    const folder = folderOf(value);
    if (!folder) return;
    const seen = ranked.get(folder);
    if (!seen) ranked.set(folder, { at, order: order++ });
    else if (at > seen.at) seen.at = at;
  };
  const latest = new Map<string, number>();
  for (const pane of rows.panes ?? []) {
    const at = pane.focused
      ? Number.MAX_SAFE_INTEGER
      : typeof pane.last_activity_at === "number"
        ? pane.last_activity_at
        : 0;
    offer(pane.foreground_cwd ?? pane.cwd, at);
    latest.set(
      pane.workspace_id,
      Math.max(latest.get(pane.workspace_id) ?? 0, at),
    );
  }
  for (const workspace of rows.workspaces ?? [])
    offer(
      workspace.worktree?.checkout_path ?? workspace.cwd,
      latest.get(workspace.workspace_id) ?? 0,
    );
  return [...ranked]
    .sort(([, a], [, b]) => b.at - a.at || a.order - b.order)
    .slice(0, limit)
    .map(([folder]) => folder);
}

/** The recent folders of one connection, as World observes it now. */
export function useRecentFolders(connectionId: string | null): string[] {
  const state = useSyncExternalStore(
    worldRuntimeStore.subscribe,
    worldRuntimeStore.get,
    worldRuntimeStore.get,
  );
  const snapshot = connectionId
    ? (state.connections.find(
        (connection) =>
          connection.connectionId === connectionId && !connection.stale,
      )?.snapshot ?? null)
    : null;
  return useMemo(() => recentFolders(snapshot), [snapshot]);
}

/** The folder one level up, keeping ~/ spelling; null at the top. */
export function parentFolder(path: string): string | null {
  const folder = path.replace(/\/+$/, "");
  if (!folder || folder === "~") return null;
  const cut = folder.lastIndexOf("/");
  if (cut < 0) return null;
  return cut === 0 ? "/" : folder.slice(0, cut);
}

/**
 * Tab completion for a typed folder: the longest shared start of the
 * suggestions (full paths on the host), with a slash once only one is left.
 * Null when it adds nothing to what `resolved` (the typed path, resolved)
 * already says.
 */
export function completeFolder(
  resolved: string,
  directories: readonly string[],
): string | null {
  if (!directories.length) return null;
  let shared = directories[0]!;
  for (const directory of directories.slice(1)) {
    let index = 0;
    while (
      index < shared.length &&
      index < directory.length &&
      shared[index] === directory[index]
    )
      index += 1;
    shared = shared.slice(0, index);
  }
  const completed = directories.length === 1 ? `${shared}/` : shared;
  return completed.length > resolved.length ? completed : null;
}
