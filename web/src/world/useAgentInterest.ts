import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  type Interest,
  interestKey,
  type StoredInterest,
} from "../../../shared/interest";
import {
  type BoardDocumentStore,
  sharedBoardStore,
} from "./board/boardDocument";
import { type WorldRuntimeState, worldRuntimeStore } from "./runtimeStore";

/**
 * Each agent's interest as World's service keeps it (shared/interest.ts), for
 * chimes and the Inspector's Watching / Muted / Focused control.
 */

type StoredInterests = Readonly<Record<string, StoredInterest>>;

export type AgentInterest = {
  interestOf(connectionId: string, terminalId: string): Interest;
  /**
   * Whether a focused agent is reachable now, so that only focused agents
   * chime. A focus on a host that is offline or gone does not count; it
   * applies again when the host is back.
   */
  anyFocused: boolean;
};

const NONE: StoredInterests = Object.freeze({});

/** The previous records while none changed, so their identity is stable. */
export function keepInterests(
  last: StoredInterests,
  next: StoredInterests,
): StoredInterests {
  const keys = Object.keys(next);
  return keys.length === Object.keys(last).length &&
    keys.every((key) => last[key] === next[key])
    ? last
    : next;
}

/** Every terminal World shows now on a ready, current host. */
export function liveTerminalKeys(world: WorldRuntimeState): Set<string> {
  const keys = new Set<string>();
  for (const connection of world.connections) {
    if (
      connection.state !== "ready" ||
      !connection.actionable ||
      connection.stale
    )
      continue;
    for (const pane of connection.snapshot?.panes ?? [])
      if (pane.terminal_id)
        keys.add(interestKey(connection.connectionId, pane.terminal_id));
  }
  return keys;
}

/** Whether any stored focus is on a terminal World can reach now. */
export function focusReachable(
  stored: StoredInterests,
  live: ReadonlySet<string>,
) {
  return Object.entries(stored).some(
    ([key, interest]) => interest === "focused" && live.has(key),
  );
}

export function agentInterest(
  stored: StoredInterests,
  anyFocused: boolean,
): AgentInterest {
  return {
    interestOf: (connectionId, terminalId) =>
      stored[interestKey(connectionId, terminalId)] ?? "watching",
    anyFocused,
  };
}

/**
 * Every agent's interest, kept current from the World service. It changes only
 * when an interest does, so Board's other edits never re-render its readers.
 */
export function useAgentInterest(
  store: BoardDocumentStore = sharedBoardStore(),
): AgentInterest {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const last = useRef<StoredInterests>(NONE);
  const snapshot = () => {
    last.current = keepInterests(
      last.current,
      store.get().document?.layout.interest ?? NONE,
    );
    return last.current;
  };
  const stored = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  const reachable = () =>
    focusReachable(stored, liveTerminalKeys(worldRuntimeStore.get()));
  const anyFocused = useSyncExternalStore(
    worldRuntimeStore.subscribe,
    reachable,
    reachable,
  );
  return useMemo(() => agentInterest(stored, anyFocused), [stored, anyFocused]);
}

/** Watch, mute or focus an agent's terminal. */
export function setAgentInterest(
  connectionId: string,
  terminalId: string,
  interest: Interest,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([
    {
      op: "interest.set",
      key: interestKey(connectionId, terminalId),
      interest: interest === "watching" ? null : interest,
    },
  ]);
}
