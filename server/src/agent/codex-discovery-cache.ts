import type { CodexDaemonThread } from "./codex-app-server";

export type CodexDiscoveryScope = { connectionId: string; generation: number };

/** Runtime-owned metadata only: successful results live for one in-flight read. */
export function createCodexDiscoveryCache(
  scope?: CodexDiscoveryScope,
  now = Date.now,
) {
  const pending = new Map<string, Promise<CodexDaemonThread[] | null>>();
  let unavailableUntil = 0;
  let epoch = 0;
  return {
    clear() {
      epoch++;
      pending.clear();
      unavailableUntil = 0;
    },
    read(
      cwd: string | undefined,
      witness: string,
      fetch: () => Promise<CodexDaemonThread[] | null>,
    ) {
      if (now() < unavailableUntil) return Promise.resolve(null);
      const key = JSON.stringify([
        scope?.connectionId,
        scope?.generation,
        cwd,
        witness,
      ]);
      const existing = pending.get(key);
      if (existing) return existing;
      const expected = epoch;
      const result: Promise<CodexDaemonThread[] | null> = Promise.resolve()
        .then(fetch)
        .catch(() => null)
        .then((threads) => {
          if (epoch === expected) {
            if (pending.get(key) === result) pending.delete(key);
            if (threads === null) unavailableUntil = now() + 60_000;
          }
          return threads;
        });
      pending.set(key, result);
      return result;
    },
  };
}

export type CodexDiscoveryCache = ReturnType<typeof createCodexDiscoveryCache>;
