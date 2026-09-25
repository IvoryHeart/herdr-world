import { worldLocalStorage } from "../browserStorage";
import type { ConnectionClient } from "../api";
import { connectionHttpPath } from "../connectionHttp";
import { connectionStorageKey } from "../connectionStorage";
import { gitDiffCode, type GitDiffCode } from "../gitDiffStatus";
import { retireGitDiffSummaryResource } from "../gitDiffSummaryStore";
import { connectionClientScopeKey } from "../useConnectionClient";
import type {
  FileExplorerEntry,
  FileExplorerList,
  FilePreview,
  GitDiffEntry,
  GitDiffKind,
  GitDiffSummary,
} from "../types";

export function workspaceName(workspace?: {
  label?: string;
  workspace_id?: string;
}) {
  return workspace?.label || workspace?.workspace_id || "";
}

export function displaySize(entry: FileExplorerEntry) {
  if (entry.type === "directory") return "";
  if (entry.size < 1024) return `${entry.size} B`;
  if (entry.size < 1024 * 1024) return `${Math.round(entry.size / 1024)} KB`;
  return `${(entry.size / 1024 / 1024).toFixed(1)} MB`;
}

// Entry paths use "/". Only Windows roots use backslash separators; POSIX
// directory names can contain literal backslashes.
export function absolutePath(root: string, entry: FileExplorerEntry) {
  if (/^(?:\/|[a-z]:[\\/])/i.test(entry.path)) return entry.path;
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(root) && root.includes("\\")) {
    return `${root.replace(/[\\/]+$/, "")}\\${entry.path.replace(/\//g, "\\")}`;
  }
  return `${root.replace(/\/+$/, "")}/${entry.path}`;
}

export function initialWorkspacePath(workspace?: {
  worktree?: { checkout_path: string };
  cwd?: string;
}) {
  return workspace?.worktree?.checkout_path ?? workspace?.cwd ?? "";
}

export type FileExplorerCache = {
  search: string;
  rootInfo: FileExplorerList | null;
  children: Record<string, FileExplorerEntry[]>;
  expanded: Set<string>;
  error: string | null;
};

type FileGitStatus = {
  label: string;
  title: string;
  tone: string;
  priority: number;
  count?: number;
  entry?: GitDiffEntry;
  entries?: GitDiffEntry[];
  codes: GitDiffCode[];
};

const explorerCache = new Map<string, FileExplorerCache>();
const explorerCacheRevisions = new Map<string, number>();
const explorerPrefetches = new Map<string, Promise<void>>();
const previewCache = new Map<string, FilePreview>();
const previewRequests = new Map<string, Promise<FilePreview>>();
const previewRequestRevisions = new Map<string, number>();
const MAX_PREVIEW_CACHE_BYTES = 16 * 1024 * 1024;
let previewCacheBytes = 0;
let previewResourceRevision = 0;
export const FILE_SHOW_HIDDEN_PREFIX = "fileExplorerShowHidden:";

export function explorerRuntimeContextKey(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  workspaceId?: string,
  resourceKey = workspaceId,
) {
  return connectionClientScopeKey(
    client,
    "explorer-runtime",
    resourceKey ?? "focused",
    workspaceId ?? "missing",
  );
}

export function explorerCacheKey(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  workspaceId?: string,
  showHidden = false,
  resourceKey = workspaceId,
) {
  return connectionClientScopeKey(
    client,
    "explorer",
    resourceKey ?? "focused",
    showHidden,
  );
}

function explorerCacheRevision(key: string): number {
  return explorerCacheRevisions.get(key) ?? 0;
}

export function advanceExplorerCacheRevision(key: string): number {
  const next = explorerCacheRevision(key) + 1;
  explorerCacheRevisions.set(key, next);
  explorerPrefetches.delete(key);
  return next;
}

function retireExplorerCache(key: string) {
  advanceExplorerCacheRevision(key);
  explorerCache.delete(key);
}

export function clearFileExplorerResourceCache(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  resourceKey: string,
  storage: Pick<Storage, "removeItem"> = worldLocalStorage,
) {
  for (const showHidden of [false, true]) {
    const key = explorerCacheKey(client, undefined, showHidden, resourceKey);
    retireExplorerCache(key);
  }
  retireGitDiffSummaryResource(client, resourceKey);
  storage.removeItem(
    connectionStorageKey(
      client.connectionId,
      `${FILE_SHOW_HIDDEN_PREFIX}${resourceKey}`,
    ),
  );
}

function emptyExplorerCache(): FileExplorerCache {
  return {
    search: "",
    rootInfo: null,
    children: {},
    expanded: new Set([""]),
    error: null,
  };
}

export function readExplorerCache(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  workspaceId?: string,
  showHidden = false,
  resourceKey = workspaceId,
) {
  const key = explorerCacheKey(client, workspaceId, showHidden, resourceKey);
  const cached = explorerCache.get(key);
  if (cached) {
    return {
      ...cached,
      children: { ...cached.children },
      expanded: new Set(cached.expanded),
    };
  }
  const next = emptyExplorerCache();
  explorerCache.set(key, {
    ...next,
    children: { ...next.children },
    expanded: new Set(next.expanded),
  });
  return next;
}

export function writeExplorerCache(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  workspaceId: string | undefined,
  showHidden: boolean,
  patch: Partial<FileExplorerCache>,
  resourceKey = workspaceId,
) {
  const key = explorerCacheKey(client, workspaceId, showHidden, resourceKey);
  const current = explorerCache.get(key) ?? emptyExplorerCache();
  explorerCache.set(key, {
    ...current,
    ...patch,
    children: patch.children ? { ...patch.children } : { ...current.children },
    expanded: patch.expanded
      ? new Set(patch.expanded)
      : new Set(current.expanded),
  });
}

export function filePreviewCacheKey(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  workspaceId: string | undefined,
  path: string,
) {
  return connectionClientScopeKey(
    client,
    "preview",
    workspaceId ?? "focused",
    path,
  );
}

function estimatedPreviewBytes(preview: FilePreview) {
  return (
    ((preview.text?.length ?? 0) + (preview.image_data_url?.length ?? 0)) * 2 +
    256
  );
}

export function readCachedPreview(key: string) {
  const preview = previewCache.get(key);
  if (!preview) return undefined;
  previewCache.delete(key);
  previewCache.set(key, preview);
  return preview;
}

function removeCachedPreview(key: string, retireRequest = false) {
  const existing = previewCache.get(key);
  if (existing) {
    previewCacheBytes = Math.max(
      0,
      previewCacheBytes - estimatedPreviewBytes(existing),
    );
  }
  previewCache.delete(key);
  if (retireRequest) {
    const running = previewRequests.has(key);
    previewRequests.delete(key);
    if (running) {
      previewRequestRevisions.set(
        key,
        (previewRequestRevisions.get(key) ?? 0) + 1,
      );
    } else {
      previewRequestRevisions.delete(key);
    }
  } else if (!previewRequests.has(key)) {
    previewRequestRevisions.delete(key);
  }
}

function previewCacheKeyParts(key: string) {
  try {
    const parts = JSON.parse(key) as unknown[];
    if (
      typeof parts[0] !== "string" ||
      typeof parts[1] !== "number" ||
      parts[2] !== "preview" ||
      typeof parts[3] !== "string" ||
      typeof parts[4] !== "string"
    ) {
      return null;
    }
    return {
      connectionId: parts[0],
      generation: parts[1],
      workspaceId: parts[3],
      path: parts[4],
    };
  } catch {
    return null;
  }
}

export function invalidateFilePreviewCache(
  client: Pick<ConnectionClient, "connectionId" | "generation">,
  workspaceId: string,
  path: string,
  recursive = false,
) {
  const keys = new Set([...previewCache.keys(), ...previewRequests.keys()]);
  for (const key of keys) {
    const parts = previewCacheKeyParts(key);
    if (
      !parts ||
      parts.connectionId !== client.connectionId ||
      parts.generation !== client.generation ||
      parts.workspaceId !== workspaceId
    ) {
      continue;
    }
    if (
      parts.path === path ||
      (recursive && parts.path.startsWith(`${path}/`))
    ) {
      removeCachedPreview(key, true);
    }
  }
}

function writeCachedPreview(key: string, preview: FilePreview) {
  removeCachedPreview(key);
  previewCache.set(key, preview);
  previewCacheBytes += estimatedPreviewBytes(preview);

  while (previewCacheBytes > MAX_PREVIEW_CACHE_BYTES && previewCache.size > 1) {
    const oldestKey = previewCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    removeCachedPreview(oldestKey);
  }
}

export function parentDirectoryPaths(path: string) {
  const parts = path.split("/").filter(Boolean);
  const directories: string[] = [""];
  for (let i = 1; i < parts.length; i += 1) {
    directories.push(parts.slice(0, i).join("/"));
  }
  return directories;
}

export function parentDirectoryPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function directoryPaths(path: string) {
  const parts = path.split("/").filter(Boolean);
  return ["", ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))];
}

export function isWorkspaceRelativePath(path: string) {
  return Boolean(path) && !/^(?:\/|[a-z]:[\\/])/i.test(path);
}

function normalizeDisplayPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function relativeDisplayPath(from: string, to: string) {
  const base = normalizeDisplayPath(from);
  const target = normalizeDisplayPath(to);
  if (!base || !target) return null;
  if (base === target) return "";
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : null;
}

function mapGitPathToExplorerPath(
  gitRoot: string,
  explorerRoot: string,
  gitPath: string,
) {
  const normalizedGitPath = normalizeDisplayPath(gitPath).replace(/^\/+/, "");
  const explorerWithinGit = relativeDisplayPath(gitRoot, explorerRoot);
  if (explorerWithinGit !== null) {
    if (!explorerWithinGit) return normalizedGitPath;
    return normalizedGitPath === explorerWithinGit ||
      normalizedGitPath.startsWith(`${explorerWithinGit}/`)
      ? normalizedGitPath.slice(explorerWithinGit.length).replace(/^\/+/, "")
      : null;
  }
  const gitWithinExplorer = relativeDisplayPath(explorerRoot, gitRoot);
  if (gitWithinExplorer !== null) {
    return gitWithinExplorer
      ? `${gitWithinExplorer}/${normalizedGitPath}`
      : normalizedGitPath;
  }
  return normalizedGitPath;
}

function gitStatusTone(entry: Pick<GitDiffEntry, "kind" | "status">) {
  if (entry.kind === "conflicted") return "conflict";
  if (entry.kind === "untracked") return "untracked";
  switch (entry.status) {
    case "added":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
    case "copied":
      return "added";
    case "type changed":
      return "modified";
    default:
      return entry.kind === "staged" ? "staged" : "modified";
  }
}

function gitStatusLabel(entry: Pick<GitDiffEntry, "kind" | "status">) {
  if (entry.kind === "conflicted") return "Conflict";
  if (entry.kind === "untracked") return "Untracked";
  switch (entry.status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "copied":
      return "Copied";
    case "type changed":
      return "Type changed";
    case "modified":
    default:
      return "Modified";
  }
}

function gitStatusPriority(entry: Pick<GitDiffEntry, "kind" | "status">) {
  if (entry.kind === "conflicted") return 100;
  if (entry.status === "deleted") return 90;
  if (entry.kind === "untracked") return 80;
  if (entry.status === "added") return 70;
  if (entry.kind === "staged") return 60;
  return 50;
}

function gitKindLabel(kind: GitDiffKind) {
  switch (kind) {
    case "staged":
      return "staged";
    case "unstaged":
      return "unstaged";
    case "untracked":
      return "untracked";
    case "conflicted":
      return "conflicted";
    case "branch":
      return "branch";
    default:
      return kind;
  }
}

export function buildGitStatusMaps(
  summary: GitDiffSummary | null,
  explorerRoot?: string,
) {
  const fileStatuses = new Map<string, FileGitStatus>();
  const directoryChangedFiles = new Map<string, Set<string>>();
  const directoryCodes = new Map<string, Set<GitDiffCode>>();
  if (!summary || !explorerRoot)
    return {
      fileStatuses,
      directoryStatuses: new Map<string, FileGitStatus>(),
    };

  const descriptions = new Map<string, string[]>();
  for (const entry of summary.entries) {
    const mappedPath = mapGitPathToExplorerPath(
      summary.root,
      explorerRoot,
      entry.path,
    );
    if (!mappedPath) continue;
    const existing = fileStatuses.get(mappedPath);
    const codes = Array.from(
      new Set([...(existing?.codes ?? []), gitDiffCode(entry)]),
    ).sort();
    const entries = [...(existing?.entries ?? []), entry];
    const next: FileGitStatus = {
      label: gitStatusLabel(entry),
      title: `${gitKindLabel(entry.kind)} ${entry.status}`,
      tone: gitStatusTone(entry),
      priority: gitStatusPriority(entry),
      entry,
      entries,
      codes,
    };
    const currentDescriptions = descriptions.get(mappedPath) ?? [];
    currentDescriptions.push(next.title);
    descriptions.set(mappedPath, currentDescriptions);
    const preferred =
      !existing || next.priority > existing.priority ? next : existing;
    const orderedEntries = [
      ...entries.filter((candidate) => candidate !== preferred.entry),
      ...(preferred.entry ? [preferred.entry] : []),
    ];
    if (preferred === next) {
      fileStatuses.set(mappedPath, { ...next, entries: orderedEntries });
    } else if (existing) {
      existing.codes = codes;
      existing.entries = orderedEntries;
    }

    const parts = mappedPath.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i += 1) {
      const directory = parts.slice(0, i + 1).join("/");
      const changedFiles =
        directoryChangedFiles.get(directory) ?? new Set<string>();
      changedFiles.add(mappedPath);
      directoryChangedFiles.set(directory, changedFiles);
      const codesBelow =
        directoryCodes.get(directory) ?? new Set<GitDiffCode>();
      codesBelow.add(gitDiffCode(entry));
      directoryCodes.set(directory, codesBelow);
    }
  }

  for (const [path, status] of fileStatuses) {
    const statusDescriptions = descriptions.get(path);
    if (statusDescriptions?.length) {
      status.title = Array.from(new Set(statusDescriptions)).join(", ");
    }
  }

  const directoryStatuses = new Map<string, FileGitStatus>();
  for (const [path, changedFiles] of directoryChangedFiles) {
    const count = changedFiles.size;
    directoryStatuses.set(path, {
      label: `${count} ${count === 1 ? "change" : "changes"}`,
      title: `${count} changed ${count === 1 ? "file" : "files"} below this directory`,
      tone: "directory",
      priority: 10,
      count,
      codes: Array.from(directoryCodes.get(path) ?? []).sort(),
    });
  }

  return { fileStatuses, directoryStatuses };
}

export function requestFilePreview(
  workspaceId: string,
  path: string,
  options: { refresh?: boolean; client: ConnectionClient },
) {
  const client = options.client;
  if (!client.isCurrent()) {
    return Promise.reject(new Error("connection changed during file preview"));
  }
  const key = filePreviewCacheKey(client, workspaceId, path);
  const cached = readCachedPreview(key);
  if (cached && !options.refresh) return Promise.resolve(cached);
  const running = previewRequests.get(key);
  if (running) return running;

  const revision = (previewRequestRevisions.get(key) ?? 0) + 1;
  previewRequestRevisions.set(key, revision);
  const task = client.call("file.read", {
    workspace_id: workspaceId,
    path,
  }) as Promise<FilePreview>;
  const scopedTask = task
    .then((preview) => {
      if (!client.isCurrent()) {
        throw new Error("connection changed during file preview");
      }
      if (previewRequestRevisions.get(key) !== revision) {
        throw new Error("file preview request superseded");
      }
      previewResourceRevision += 1;
      const versionedPreview = {
        ...preview,
        resource_revision: previewResourceRevision,
      };
      writeCachedPreview(key, versionedPreview);
      return versionedPreview;
    })
    .finally(() => {
      if (previewRequests.get(key) === scopedTask) {
        previewRequests.delete(key);
      }
      if (!previewCache.has(key) && !previewRequests.has(key)) {
        previewRequestRevisions.delete(key);
      }
    });
  previewRequests.set(key, scopedTask);
  return scopedTask;
}

export async function uploadExplorerFile(
  client: ConnectionClient,
  workspaceId: string,
  directory: string,
  file: File,
) {
  if (!client.isCurrent()) throw new Error("connection changed during upload");
  const url = new URL(
    connectionHttpPath(
      client.connectionId,
      "/file/upload",
      client.serverRuntimeGeneration,
    ),
    window.location.origin,
  );
  if (url.origin !== window.location.origin)
    throw new Error("invalid upload origin");
  url.searchParams.set("workspace_id", workspaceId);
  url.searchParams.set("directory", directory);
  url.searchParams.set("filename", file.name);
  const response = await fetch(url, {
    method: "POST",
    body: file,
  });
  const text = await response.text();
  if (!client.isCurrent()) throw new Error("connection changed during upload");
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    throw new Error(
      payload?.error || text || `upload failed ${response.status}`,
    );
  }
  return payload as {
    path: string;
    size: number;
    overwritten: boolean;
  };
}

export async function deleteExplorerEntry(
  client: ConnectionClient,
  workspaceId: string,
  path: string,
) {
  if (!client.isCurrent()) throw new Error("connection changed during delete");
  const url = new URL(
    connectionHttpPath(
      client.connectionId,
      "/file/delete",
      client.serverRuntimeGeneration,
    ),
    window.location.origin,
  );
  if (url.origin !== window.location.origin)
    throw new Error("invalid delete origin");
  url.searchParams.set("workspace_id", workspaceId);
  url.searchParams.set("path", path);
  const response = await fetch(url, { method: "POST" });
  const text = await response.text();
  if (!client.isCurrent()) throw new Error("connection changed during delete");
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    throw new Error(
      payload?.error || text || `delete failed ${response.status}`,
    );
  }
  return payload as {
    path: string;
    type: FileExplorerEntry["type"];
  };
}

export function prefetchFileExplorerWorkspace(
  workspaceId: string | undefined,
  client: ConnectionClient,
  resourceKey = workspaceId,
) {
  if (!workspaceId || !client.isCurrent()) return Promise.resolve();
  const showHidden = false;
  const key = explorerCacheKey(client, workspaceId, showHidden, resourceKey);
  const running = explorerPrefetches.get(key);
  if (running) return running;
  const revision = explorerCacheRevision(key);

  const task = (async () => {
    const cached = readExplorerCache(
      client,
      workspaceId,
      showHidden,
      resourceKey,
    );
    const paths = Array.from(cached.expanded);
    if (!paths.includes("")) paths.unshift("");

    for (const path of paths) {
      const list = (await client.call("file.list", {
        workspace_id: workspaceId,
        path,
        show_hidden: showHidden,
      })) as FileExplorerList;
      if (!client.isCurrent() || explorerCacheRevision(key) !== revision) {
        return;
      }
      const latest = readExplorerCache(
        client,
        workspaceId,
        showHidden,
        resourceKey,
      );
      writeExplorerCache(
        client,
        workspaceId,
        showHidden,
        {
          rootInfo: list,
          children: { ...latest.children, [path]: list.entries },
          expanded: latest.expanded,
          error: null,
        },
        resourceKey,
      );
    }
  })()
    .catch(() => {
      // Background warmups should never surface transient bridge errors.
    })
    .finally(() => {
      if (explorerPrefetches.get(key) === task) {
        explorerPrefetches.delete(key);
      }
    });

  explorerPrefetches.set(key, task);
  return task;
}
