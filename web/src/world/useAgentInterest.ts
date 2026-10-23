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

/**
 * Each agent's interest as World's service keeps it (shared/interest.ts), for
 * chimes and the Inspector's Watching / Muted / Focused control.
 */

type StoredInterests = Readonly<Record<string, StoredInterest>>;

export type AgentInterest = {
  interestOf(connectionId: string, terminalId: string): Interest;
  /** Whether any agent is focused, so that only focused agents chime. */
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

export function agentInterest(stored: StoredInterests): AgentInterest {
  return {
    interestOf: (connectionId, terminalId) =>
      stored[interestKey(connectionId, terminalId)] ?? "watching",
    anyFocused: Object.values(stored).includes("focused"),
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
  return useMemo(() => agentInterest(stored), [stored]);
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
