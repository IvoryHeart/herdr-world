import type { CodexDaemonThread } from "./codex-app-server";

export type CodexDiscoveryScope = { connectionId: string; generation: number };

/** Runtime-owned metadata only: successful results live for one in-flight read. */
export function createCodexDiscoveryCache(
  scope?: CodexDiscoveryScope,
  now = Date.now,
) {
  const pending = new Map<
    string,
    { witness: string; promise: Promise<CodexDaemonThread[] | null> }
  >();
  const unavailableUntil = new Map<string, number>();
  let epoch = 0;
  return {
    clear() {
      epoch++;
      pending.clear();
      unavailableUntil.clear();
    },
    read(
      cwd: string,
      witness: string,
      fetch: () => Promise<CodexDaemonThread[] | null>,
      kind: "single" | "snapshot" = "single",
    ) {
      for (const [key, until] of unavailableUntil)
        if (until <= now()) unavailableUntil.delete(key);
      const failureKey = JSON.stringify([
        scope?.connectionId,
        scope?.generation,
        cwd,
        kind,
      ]);
      if (now() < (unavailableUntil.get(failureKey) ?? 0))
        return Promise.resolve(null);
      // Retain the shared witness by reference, rather than copy the entire
      // pane snapshot into every directory's map key.
      const key = failureKey;
      const existing = pending.get(key);
      if (existing?.witness === witness) return existing.promise;
      const expected = epoch;
      const result: Promise<CodexDaemonThread[] | null> = Promise.resolve()
        .then(fetch)
        .catch(() => null)
        .then((threads) => {
          if (epoch === expected) {
            if (pending.get(key)?.promise === result) pending.delete(key);
            if (threads === null)
              unavailableUntil.set(failureKey, now() + 60_000);
          }
          return threads;
        });
      pending.set(key, { witness, promise: result });
      return result;
    },
  };
}

export type CodexDiscoveryCache = ReturnType<typeof createCodexDiscoveryCache>;
