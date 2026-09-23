const diffCollapseStateCache = new Map<string, ReadonlyMap<string, boolean>>();

export function readDiffCollapseState(resourceKey: string) {
  return diffCollapseStateCache.get(resourceKey);
}

export function writeDiffCollapseState(
  resourceKey: string,
  state: ReadonlyMap<string, boolean>,
) {
  diffCollapseStateCache.set(resourceKey, state);
}

export function clearDiffContentResourceState(resourceKey: string) {
  diffCollapseStateCache.delete(resourceKey);
}

/** Selecting a file is an explicit request to view it: record a manual
 *  expand so prior manual collapses and auto-collapse defaults yield. */
export function expandDiffEntryOnActivate(
  current: ReadonlyMap<string, boolean> | undefined,
  key: string,
): ReadonlyMap<string, boolean> {
  if (current?.get(key) === false) return current;
  const next = new Map(current);
  next.set(key, false);
  return next;
}
