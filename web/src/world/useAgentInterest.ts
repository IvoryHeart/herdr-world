import { useEffect, useMemo, useSyncExternalStore } from "react";
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
import { buildGroupViews } from "../../../shared/groupViews";
import { deriveGroupInterest } from "../../../shared/groupInterest";
import { groupRuntimeObservations } from "./groupObservations";
import { setChimeInterestSource } from "../chimes/chimeCenter";

/**
 * Each agent's interest as World's service keeps it (shared/interest.ts), for
 * chimes and the Inspector's Watching / Muted / Focused control.
 */

type StoredInterests = Readonly<Record<string, StoredInterest>>;

export type AgentInterest = {
  interestOf(connectionId: string, terminalId: string): Interest;
  overrideOf(connectionId: string, terminalId: string): Interest | null;
  descriptionOf(connectionId: string, terminalId: string): string;
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
    overrideOf: (connectionId, terminalId) =>
      stored[interestKey(connectionId, terminalId)] ?? null,
    descriptionOf: (connectionId, terminalId) =>
      stored[interestKey(connectionId, terminalId)]
        ? `${stored[interestKey(connectionId, terminalId)]} · individual override`
        : "Watched · Default (from groups)",
    anyFocused,
  };
}

/** Cached, current policy shared by UI and the actual chime adapter. */
export function createAgentInterestReader(
  store: Pick<BoardDocumentStore, "get" | "subscribe">,
  runtime: Pick<
    typeof worldRuntimeStore,
    "get" | "subscribe"
  > = worldRuntimeStore,
) {
  let previousDocument: ReturnType<typeof store.get>["document"] | undefined;
  let previousConnections: WorldRuntimeState["connections"] | undefined;
  let signature = "";
  let value = agentInterest(NONE, false);
  const get = () => {
    const document = store.get().document;
    const world = runtime.get();
    if (
      document === previousDocument &&
      world.connections === previousConnections
    )
      return value;
    previousDocument = document;
    previousConnections = world.connections;
    const stored = document?.layout.interest ?? NONE;
    const intents = document?.layout.group_interest ?? {};
    const groups = Object.keys(intents).length
      ? buildGroupViews(
          document?.relations?.groups ?? [],
          groupRuntimeObservations(world.connections),
        )
      : [];
    const derived = deriveGroupInterest(stored, intents, groups);
    let reachable: ReadonlySet<string> | undefined;
    const anyFocused = [...derived].some(([key, interest]) => {
      if (interest.value !== "focused") return false;
      reachable ??= liveTerminalKeys(world);
      return reachable.has(key);
    });
    const nextSignature = JSON.stringify([
      Object.entries(stored).sort(),
      [...derived].sort(),
      anyFocused,
    ]);
    if (nextSignature === signature) return value;
    signature = nextSignature;
    value = {
      interestOf: (connectionId, terminalId) =>
        derived.get(interestKey(connectionId, terminalId))?.value ?? "watching",
      overrideOf: (connectionId, terminalId) =>
        stored[interestKey(connectionId, terminalId)] ?? null,
      descriptionOf: (connectionId, terminalId) =>
        derived.get(interestKey(connectionId, terminalId))?.description ??
        "Watched · Default (from groups)",
      anyFocused,
    };
    return value;
  };
  const subscribe = (listener: () => void) => {
    const offBoard = store.subscribe(listener);
    const offRuntime = runtime.subscribe(listener);
    return () => {
      offBoard();
      offRuntime();
    };
  };
  return { get, subscribe };
}

/** Only effective interest changes re-render consumers; Board geometry does not. */
export function useAgentInterest(
  store: BoardDocumentStore = sharedBoardStore(),
): AgentInterest {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const reader = useMemo(() => createAgentInterestReader(store), [store]);
  return useSyncExternalStore(reader.subscribe, reader.get, reader.get);
}

/** Connect the live policy to chime decisions, not just to the Inspector chip. */
export function startAgentChimeInterest(
  store: BoardDocumentStore = sharedBoardStore(),
) {
  store.start();
  const reader = createAgentInterestReader(store);
  setChimeInterestSource({
    interestOf: (connectionId, terminalId) =>
      reader.get().interestOf(connectionId, terminalId),
    anyFocused: () => reader.get().anyFocused,
  });
  return () => {
    setChimeInterestSource(null);
    store.stop();
  };
}

/** Watch, mute or focus an agent's terminal. */
export function setAgentInterest(
  connectionId: string,
  terminalId: string,
  interest: Interest | null,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([
    {
      op: "interest.set",
      key: interestKey(connectionId, terminalId),
      interest,
    },
  ]);
}
