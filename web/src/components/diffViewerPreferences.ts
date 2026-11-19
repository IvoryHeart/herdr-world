import { worldLocalStorage } from "../browserStorage";
import { connectionStorageKey } from "../connectionStorage";
type DiffScope = "working" | "branch-main" | "last-step";

const DIFF_SCOPE_KEY = "diffViewerScope";

export function comparisonBranchStorageKey(
  connectionId: string,
  resourceKey: string,
) {
  return connectionStorageKey(connectionId, `diffViewerBase:${resourceKey}`);
}

export function comparisonResourceKey(
  resourceKey: string | undefined,
  baseBranch: string,
) {
  return baseBranch
    ? JSON.stringify(["diff-comparison", resourceKey, baseBranch])
    : resourceKey;
}

export function comparisonBranchLabel(ref: string) {
  return ref.replace(/^refs\/(heads|remotes)\//, "");
}

export function diffScopeStorageKey(
  connectionId: string,
  resourceKey?: string,
) {
  return connectionStorageKey(
    connectionId,
    resourceKey ? `${DIFF_SCOPE_KEY}:${resourceKey}` : DIFF_SCOPE_KEY,
  );
}

export function loadDiffScope(
  connectionId = "startup-default",
  resourceKey?: string,
): DiffScope {
  const scoped = worldLocalStorage.getItem(
    diffScopeStorageKey(connectionId, resourceKey),
  );
  const value =
    scoped ??
    (resourceKey
      ? worldLocalStorage.getItem(diffScopeStorageKey(connectionId))
      : null);
  if (value === "branch-main") return "branch-main";
  if (value === "last-step") return "last-step";
  return "working";
}
