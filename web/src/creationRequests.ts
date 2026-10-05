import { useSyncExternalStore } from "react";
import { UncertainRequestError } from "./api";

export type CreationSource = {
  connectionId: string;
  runtimeGeneration: number;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  terminal_id: string;
};

type Demand = { source: CreationSource; consumers: number };
const demands = new Map<string, Demand>();
const listeners = new Set<() => void>();
let snapshot: readonly CreationSource[] = [];

export function creationSourceKey(source: CreationSource) {
  return JSON.stringify([
    source.connectionId,
    source.runtimeGeneration,
    source.workspace_id,
    source.tab_id,
    source.pane_id,
    source.terminal_id,
  ]);
}

function publish() {
  snapshot = [...demands.values()].map(({ source }) => source);
  for (const listener of listeners) listener();
}

export function retainCreationSource(source: CreationSource) {
  const key = creationSourceKey(source);
  const existing = demands.get(key);
  if (existing) existing.consumers++;
  else {
    demands.set(key, { source, consumers: 1 });
    publish();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const demand = demands.get(key);
    if (demand && --demand.consumers === 0) {
      demands.delete(key);
      publish();
    }
  };
}

export function useCreationSources() {
  return useSyncExternalStore(subscribeCreationSources, () => snapshot);
}

export function subscribeCreationSources(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function creationSources() {
  return snapshot;
}

export type CreationEvent = {
  id: number;
  connectionId: string;
  runtimeGeneration: number;
  kind: "tab" | "workspace";
  phase: "started" | "dispatching" | "created" | "failed";
  error?: unknown;
  result?: unknown;
};
const eventListeners = new Set<(event: CreationEvent) => void>();
const pending = new Map<string, Promise<unknown>>();
let eventId = 0;
export type CreationProgress = {
  connectionId: string;
  runtimeGeneration: number;
  kind: "tab" | "workspace";
  workspaceId?: string;
  phase: "preparing" | "creating";
};
const progress = new Map<string, CreationProgress>();
let progressSnapshot: readonly CreationProgress[] = [];
const progressListeners = new Set<() => void>();
function publishProgress() {
  progressSnapshot = [...progress.values()];
  for (const listener of progressListeners) listener();
}
export function useCreationProgress() {
  return useSyncExternalStore(
    (listener) => {
      progressListeners.add(listener);
      return () => {
        progressListeners.delete(listener);
      };
    },
    () => progressSnapshot,
  );
}
export function creationPendingReason(
  owner: { connectionId: string; runtimeGeneration: number | null },
  kind: "tab" | "workspace",
  workspaceId?: string | null,
  requests = progressSnapshot,
) {
  const request = requests.find(
    (item) =>
      item.connectionId === owner.connectionId &&
      item.runtimeGeneration === owner.runtimeGeneration &&
      item.kind === kind &&
      (kind === "workspace" || item.workspaceId === workspaceId),
  );
  return request
    ? request.phase === "preparing"
      ? "Preparing the source terminal…"
      : `Creating ${kind}…`
    : null;
}
export function creationFailureMessage(
  error: unknown,
  kind: "Tab" | "Workspace",
) {
  return error instanceof UncertainRequestError
    ? `${kind} may have been created; check the destination before retrying`
    : `${kind} creation failed`;
}

export function subscribeCreations(listener: (event: CreationEvent) => void) {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

export function coordinateCreation<T>(
  owner: { connectionId: string; runtimeGeneration: number },
  kind: "tab" | "workspace",
  workspaceId: string | undefined,
  dispatch: (dispatching: () => void) => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([
    owner.connectionId,
    owner.runtimeGeneration,
    kind,
    workspaceId,
  ]);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const event = { ...owner, kind, id: ++eventId };
  const emit = (
    phase: CreationEvent["phase"],
    result?: unknown,
    error?: unknown,
  ) => {
    for (const listener of eventListeners) {
      try {
        listener({ ...event, phase, result, error });
      } catch (error) {
        console.error("Creation observer failed", error);
      }
    }
  };
  const promise = Promise.resolve()
    .then(() =>
      dispatch(() => {
        progress.set(key, { ...owner, kind, workspaceId, phase: "creating" });
        publishProgress();
        emit("dispatching");
      }),
    )
    .then(
      (result) => {
        progress.delete(key);
        publishProgress();
        emit("created", result);
        return result;
      },
      (error) => {
        progress.delete(key);
        publishProgress();
        const failure =
          error instanceof UncertainRequestError
            ? new UncertainRequestError(
                error.method,
                `Destination ${owner.connectionId} (runtime ${owner.runtimeGeneration}): ${error.message}`,
              )
            : error;
        emit("failed", undefined, failure);
        throw failure;
      },
    )
    .finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
  pending.set(key, promise);
  progress.set(key, { ...owner, kind, workspaceId, phase: "preparing" });
  publishProgress();
  emit("started");
  return promise;
}
