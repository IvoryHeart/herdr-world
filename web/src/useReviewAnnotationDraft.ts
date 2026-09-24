import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  annotationDraftStorageKey,
  readReviewAnnotations,
  writeReviewAnnotations,
  type ReviewAnnotation,
} from "./annotations";
import { worldLocalStorage } from "./browserStorage";
import { store } from "./store";
import { sameResourceOwner, type ResourceScope } from "./workspaceResource";

const EMPTY_ANNOTATIONS: ReviewAnnotation[] = [];

type ReviewAnnotationDraftSync = {
  key: string;
  annotations: ReviewAnnotation[];
  source: object;
};
const annotationDraftListeners = new Set<
  (change: ReviewAnnotationDraftSync) => void
>();

// Memory is authoritative for visited drafts, including failed writes and deletes.
// Every mutation names its owner: hidden Inspector callbacks cannot edit another draft.
export function useReviewAnnotationDraft(runtimeKey: string) {
  const [scope, setScope] = useState<ResourceScope | null>(null);
  const scopeRef = useRef<ResourceScope | null>(null);
  const drafts = useRef(new Map<string, ReviewAnnotation[]>());
  const [, refresh] = useState(0);
  const storageFailed = useRef(false);
  const sessionRef = useRef<object | null>(null);
  const syncSourceRef = useRef({});
  const runtimeRef = useRef(runtimeKey);

  const read = useCallback((owner: ResourceScope) => {
    const key = annotationDraftStorageKey(owner);
    let draft = drafts.current.get(key);
    if (!draft) {
      draft = readReviewAnnotations(worldLocalStorage, key);
      drafts.current.set(key, draft);
    }
    return draft;
  }, []);

  const select = useCallback((owner: ResourceScope | null) => {
    const changed =
      !owner ||
      !scopeRef.current ||
      scopeRef.current.workspaceId !== owner.workspaceId ||
      !sameResourceOwner(scopeRef.current, owner);
    if (!owner) sessionRef.current = null;
    else if (changed || !sessionRef.current) sessionRef.current = {};
    scopeRef.current = owner;
    setScope(owner);
    return changed;
  }, []);

  const update = useCallback(
    (
      owner: ResourceScope,
      change:
        | ReviewAnnotation[]
        | ((current: ReviewAnnotation[]) => ReviewAnnotation[]),
    ) => {
      const current = read(owner);
      const next = typeof change === "function" ? change(current) : change;
      if (
        next.length === current.length &&
        next.every((item, index) => item === current[index])
      )
        return;
      const key = annotationDraftStorageKey(owner);
      drafts.current.set(key, next);
      const persisted = writeReviewAnnotations(worldLocalStorage, key, next);
      if (!persisted && !storageFailed.current) {
        store.notify({
          kind: "error",
          message: "Review draft could not be saved",
          detail:
            "Browser storage is unavailable. Keep this page open or copy the feedback now.",
        });
      }
      storageFailed.current = !persisted;
      refresh((value) => value + 1);
      const sync = {
        key,
        annotations: next,
        source: syncSourceRef.current,
      };
      for (const listener of annotationDraftListeners) listener(sync);
    },
    [read],
  );

  useLayoutEffect(() => {
    const synchronize = (change: ReviewAnnotationDraftSync) => {
      if (change.source === syncSourceRef.current) return;
      drafts.current.set(change.key, change.annotations);
      const selected = scopeRef.current;
      if (selected && annotationDraftStorageKey(selected) === change.key) {
        refresh((value) => value + 1);
      }
    };
    annotationDraftListeners.add(synchronize);
    return () => {
      annotationDraftListeners.delete(synchronize);
    };
  }, []);
  useLayoutEffect(() => {
    if (runtimeRef.current === runtimeKey) return;
    runtimeRef.current = runtimeKey;
    sessionRef.current = null;
    scopeRef.current = null;
    setScope(null);
  }, [runtimeKey]);
  useLayoutEffect(() => {
    sessionRef.current = {};
    return () => {
      sessionRef.current = null;
    };
  }, []);

  return {
    scope,
    scopeRef,
    sessionRef,
    read,
    select,
    update,
    annotations: scope ? read(scope) : EMPTY_ANNOTATIONS,
  };
}
