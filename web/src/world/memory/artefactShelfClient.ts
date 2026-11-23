import { useSyncExternalStore } from "react";
import {
  parseArtefactShelf,
  type ArtefactShelf,
} from "../../../../shared/agentArtefacts";
import type { MemoryTarget } from "../../../../shared/memory";
import { bridge } from "../../api";
import type { FilePreview } from "../../types";
import { artefactFixtureShelf, artefactFixtureRead } from "./artefactFixture";
import {
  MEMORY_CALL_MS,
  memoryErrorText,
  memoryHosts,
  memoryTargetKey,
} from "./memoryClient";
import { memoryFixtureOn } from "./memoryFixture";

/**
 * The browser's side of `world.artefacts.list` (#1327): one host's "Made by
 * agents" shelf, read on its exact connection and generation. Only the
 * shelf's references are cached here, for the Library and the Town sign;
 * a file's contents live in the reader's state and leave with it.
 */

/**
 * A shelf this old is read again when a view asks.
 * @internal
 */
export const ARTEFACT_SHELF_FRESH_MS = 60_000;

export type ArtefactShelfClient = {
  list(target: MemoryTarget): Promise<ArtefactShelf>;
  /** A file's preview, read through a room on its host. */
  read(
    target: MemoryTarget,
    workspaceId: string | null,
    path: string,
  ): Promise<FilePreview>;
};

const bridgeClient: ArtefactShelfClient = {
  list: (target) =>
    bridge
      .call(
        "world.artefacts.list",
        {
          connection_id: target.connection_id,
          connection_generation: target.connection_generation,
        },
        MEMORY_CALL_MS,
      )
      .then((reply) => {
        const shelf = parseArtefactShelf(reply);
        if (!shelf) throw new Error("The host's reply was not a shelf.");
        return shelf;
      }),
  read: (target, workspaceId, path) => {
    if (!workspaceId)
      return Promise.reject(
        new Error("No room on this host is open to read it."),
      );
    return bridge
      .connection(target.connection_id, target.connection_generation)
      .call("file.read", {
        workspace_id: workspaceId,
        path,
      }) as Promise<FilePreview>;
  },
};

const fixtureClient: ArtefactShelfClient = {
  list: async (target) => artefactFixtureShelf(target, Date.now()),
  read: async (_target, _workspaceId, path) => artefactFixtureRead(path),
};

let override: ArtefactShelfClient | null = null;
/**
 * For tests: answer every shelf call with `client` (null restores).
 * @internal
 */
export function setArtefactShelfClientForTests(
  client: ArtefactShelfClient | null,
) {
  override = client;
  shelves.clear();
  pending.clear();
  emit();
}

export function artefactShelfClient(): ArtefactShelfClient {
  if (override) return override;
  if (memoryFixtureOn()) return fixtureClient;
  return bridgeClient;
}

type ArtefactShelfState =
  | { status: "loading"; shelf?: ArtefactShelf }
  | { status: "ready"; shelf: ArtefactShelf; at: number }
  | { status: "failed"; error: string; shelf?: ArtefactShelf; at: number };

const listeners = new Set<() => void>();
const shelves = new Map<string, ArtefactShelfState>();
const pending = new Map<string, Promise<void>>();
let version = 0;
const emit = () => {
  version += 1;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const current = (key: string) =>
  memoryHosts().some((host) => memoryTargetKey(host) === key);

/** A host's shelf while that generation is still one the Library reads. */
export function artefactShelfState(target: MemoryTarget) {
  const key = memoryTargetKey(target);
  if (!current(key)) {
    shelves.delete(key);
    return null;
  }
  return shelves.get(key) ?? null;
}

/**
 * Read a host's shelf at most once a minute unless `force`; a read under
 * way is shared, and a reply for a generation that went away is dropped.
 */
export function requestArtefactShelf(
  target: MemoryTarget,
  { force = false, now = Date.now() }: { force?: boolean; now?: number } = {},
): Promise<void> {
  const key = memoryTargetKey(target);
  const running = pending.get(key);
  if (running) return running;
  const state = shelves.get(key);
  if (
    !force &&
    state &&
    state.status !== "loading" &&
    now - state.at < ARTEFACT_SHELF_FRESH_MS
  )
    return Promise.resolve();
  shelves.set(key, { status: "loading", shelf: state?.shelf });
  emit();
  const job = artefactShelfClient()
    .list(target)
    .then(
      (shelf) => {
        if (current(key))
          shelves.set(key, { status: "ready", shelf, at: Date.now() });
      },
      (error: unknown) => {
        if (current(key))
          shelves.set(key, {
            status: "failed",
            error: memoryErrorText(error),
            shelf: state?.shelf,
            at: Date.now(),
          });
      },
    )
    .finally(() => {
      pending.delete(key);
      emit();
    });
  pending.set(key, job);
  return job;
}

/** Re-renders on any shelf change. */
export function useArtefactShelves() {
  return useSyncExternalStore(subscribe, () => version);
}
