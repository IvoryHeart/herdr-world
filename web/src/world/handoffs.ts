import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionClient } from "../api";
import { connectionClientScopeGeneration } from "../useConnectionClient";
import { worldLocalStorage } from "../browserStorage";
import type { WorldLeafObject, WorldObject } from "./worldObject";

/** Aggregate reads resolve the immutable owner of each observed leaf. */
export type DeskClients =
  | ConnectionClient
  | ((leaf: WorldLeafObject) => ConnectionClient);

export function deskScope(clients: DeskClients): string {
  return typeof clients === "function" ? "aggregate" : clients.connectionId;
}

export function deskClient(
  clients: DeskClients,
  leaf: WorldLeafObject,
): ConnectionClient | null {
  const client = typeof clients === "function" ? clients(leaf) : clients;
  return client.connectionId === leaf.connectionId &&
    connectionClientScopeGeneration(client) === leaf.generation &&
    client.isCurrent()
    ? client
    : null;
}

/** Mirrors the service's `TurnReceipt` (server/src/agent/turn-receipt.ts). */
export type TurnReceipt = {
  turn_id: string;
  ask: string | null;
  report: string | null;
  report_truncated?: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  tool_calls: number;
  commands: number;
  files: string[];
  files_truncated: boolean;
};

// Receipt and screen reads are bounded; triage itself always covers every agent.
export const MAX_POLLED_AGENTS = 40;
const REFRESH_MS = 20_000;
const HANDLED_LIMIT = 500;
// An idle agent hands something back only right after its turn; older idle
// sessions are history, not work waiting for review.
export const IDLE_WINDOW_MS = 12 * 60 * 60_000;

/** Every agent in the host filter that can be acted on now. */
export function operationalAgents(world: WorldObject): WorldLeafObject[] {
  return world.leaves.filter(
    (leaf) => leaf.kind === "agent" && leaf.actionable && !leaf.stale,
  );
}

const ATTENTION_ORDER: Record<string, number> = {
  blocked: 0,
  done: 1,
  working: 2,
  idle: 3,
};

/**
 * The agents whose transcripts and screens are read, most urgent first, so a
 * bounded read never hides an agent that is waiting on the operator.
 */
export function pollingTargets(
  leaves: readonly WorldLeafObject[],
  limit = MAX_POLLED_AGENTS,
): WorldLeafObject[] {
  return leaves
    .map((leaf, index) => ({ leaf, index }))
    .sort(
      (left, right) =>
        (ATTENTION_ORDER[left.leaf.status] ?? 4) -
          (ATTENTION_ORDER[right.leaf.status] ?? 4) || left.index - right.index,
    )
    .slice(0, limit)
    .map(({ leaf }) => leaf);
}

/**
 * Records stops this browser observed: an agent session that was working and
 * is not any more. Stops belong to one agent session in one runtime, so a
 * replacement session in the same terminal starts without its predecessor's
 * stop. `previous` (last seen status per identity) is updated in place.
 */
export function advanceObservedStops(
  stops: ReadonlyMap<string, number>,
  previous: Map<string, string>,
  leaves: readonly WorldLeafObject[],
  now: number,
): { stops: Map<string, number>; changed: boolean } {
  let changed = false;
  const next = new Map(stops);
  const current = new Map(
    leaves.map((leaf) => [leaf.id, receiptIdentity(leaf)]),
  );
  for (const leaf of leaves) {
    const identity = receiptIdentity(leaf);
    const before = previous.get(identity);
    if (before === "working" && leaf.status !== "working") {
      next.set(identity, now);
      changed = true;
    } else if (leaf.status === "working" && next.delete(identity)) {
      changed = true;
    }
    previous.set(identity, leaf.status);
  }
  const live = new Set(current.values());
  for (const key of [...next.keys()]) {
    const leafId = stopLeafId(key);
    if (leafId !== null && current.has(leafId) && !live.has(key)) {
      next.delete(key);
      changed = true;
    }
  }
  for (const key of [...previous.keys()])
    if (!live.has(key)) previous.delete(key);
  for (const [key, at] of next)
    if (now - at > IDLE_WINDOW_MS && next.delete(key)) changed = true;
  return { stops: next, changed };
}

/** The terminal (leaf) id inside a `receiptIdentity`, or null if malformed. */
function stopLeafId(identity: string): string | null {
  try {
    const value = JSON.parse(identity);
    return Array.isArray(value) && typeof value[2] === "string"
      ? value[2]
      : null;
  } catch {
    return null;
  }
}

/** The agent session a receipt describes. */
export function receiptIdentity(leaf: WorldLeafObject) {
  return JSON.stringify([
    leaf.connectionId,
    leaf.generation,
    leaf.id,
    leaf.agentSessionFingerprint ?? null,
  ]);
}

/** Changes that make a stored receipt worth fetching again. */
export function receiptTrigger(leaf: WorldLeafObject) {
  return `${leaf.status}:${leaf.lastActivityAt ?? ""}`;
}

/** A stored receipt and the agent state it was read for. */
export type StoredReceipt = { receipt: TurnReceipt | null; trigger: string };

/** What the Desk knows about one agent's latest stop. */
export type ReceiptState = {
  receipt: TurnReceipt | null;
  /** Read for the agent's present state, so its stop identity can be marked. */
  current: boolean;
};

/** The stored entry after a successful read. */
export function receiptAfterRead(
  receipt: TurnReceipt | null,
  trigger: string,
): StoredReceipt {
  return { receipt, trigger };
}

/**
 * The stored entry after a failed read. A first read that fails (for example,
 * a harness whose sessions World cannot read) settles as "no receipt", so the
 * stop can still be marked. A failed refresh keeps the previous receipt but not
 * as current; the periodic refresh retries it, and a second failure for the
 * same state settles as no receipt.
 */
export function receiptAfterError(
  previous: StoredReceipt | undefined,
  trigger: string,
  failures = 1,
): StoredReceipt {
  if (!previous) return { receipt: null, trigger };
  // The stored receipt was read for this same state: the stop has not
  // changed, so keep it (and its review identity) while reads fail.
  if (previous.trigger === trigger) return previous;
  // A second failure for the same state means the agent has become
  // unreadable (for example, a rotated transcript). Settle as "no receipt" so
  // the stop can be marked under its own observed identity: reusing the last
  // receipt would give a new stop an older stop's id, and with it that stop's
  // review mark and report.
  return failures >= 2 ? { receipt: null, trigger } : previous;
}

export function receiptStateOf(
  stored: StoredReceipt | undefined,
  leaf: WorldLeafObject,
  polled: boolean,
): ReceiptState {
  if (!polled) return { receipt: null, current: true };
  return {
    receipt: stored?.receipt ?? null,
    current: stored !== undefined && stored.trigger === receiptTrigger(leaf),
  };
}

function isReceipt(value: unknown): value is TurnReceipt {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TurnReceipt).turn_id === "string" &&
    Array.isArray((value as TurnReceipt).files)
  );
}

export function receiptEndedAt(receipt: TurnReceipt | null | undefined) {
  const ended = Date.parse(receipt?.ended_at ?? "");
  return Number.isFinite(ended) ? ended : null;
}

export function isRecent(receipt: TurnReceipt | null, now: number) {
  const ended = receiptEndedAt(receipt);
  return ended !== null && now - ended <= IDLE_WINDOW_MS;
}

export function formatSpan(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** A clock that ticks on an interval so relative times stay current. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Latest turn receipt per agent session. The stored receipt is keyed by the
 * session (`receiptIdentity`), so it stays visible while a refresh is in
 * flight; a change in status or activity (`receiptTrigger`) only marks it due.
 * Changed agents are fetched first, and every agent is refreshed on a slow
 * interval so transcript writes that land after a state change are seen.
 * Polling pauses while the page is hidden.
 */
export function useTurnReceipts(
  leaves: WorldLeafObject[],
  clients: DeskClients,
) {
  const [receipts, setReceipts] = useState<Map<string, StoredReceipt>>(
    () => new Map(),
  );
  const [tick, setTick] = useState(0);
  const fetched = useRef(new Map<string, string>());
  const due = useRef(new Set<string>());
  const failures = useRef(
    new Map<string, { trigger: string; count: number }>(),
  );
  const targets = pollingTargets(leaves);
  const requestKeys = targets
    .map((leaf) => `${receiptIdentity(leaf)}=${receiptTrigger(leaf)}`)
    .join("\n");

  useEffect(() => {
    setReceipts(new Map());
    fetched.current = new Map();
    due.current = new Set();
  }, [deskScope(clients)]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") setTick((v) => v + 1);
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (tick > 0)
      for (const leaf of targets) due.current.add(receiptIdentity(leaf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  useEffect(() => {
    const live = new Set(targets.map(receiptIdentity));
    for (const key of [...fetched.current.keys()])
      if (!live.has(key)) fetched.current.delete(key);
    for (const key of [...due.current])
      if (!live.has(key)) due.current.delete(key);
    for (const key of [...failures.current.keys()])
      if (!live.has(key)) failures.current.delete(key);
    setReceipts((current) => {
      const kept = new Map([...current].filter(([key]) => live.has(key)));
      return kept.size === current.size ? current : kept;
    });
    if (document.visibilityState === "hidden") return;
    const queue = targets.filter((leaf) => {
      const identity = receiptIdentity(leaf);
      return (
        due.current.has(identity) ||
        fetched.current.get(identity) !== receiptTrigger(leaf)
      );
    });
    let cancelled = false;
    void (async () => {
      for (const leaf of queue) {
        if (cancelled) return;
        const client = deskClient(clients, leaf);
        if (!client) continue;
        // A page hidden mid-queue stops reading; unread agents stay due and
        // are read when it is shown again.
        if (document.visibilityState === "hidden") return;
        const identity = receiptIdentity(leaf);
        const trigger = receiptTrigger(leaf);
        if (!leaf.pane.agent) {
          fetched.current.set(identity, trigger);
          due.current.delete(identity);
          setReceipts((current) =>
            new Map(current).set(identity, receiptAfterRead(null, trigger)),
          );
          continue;
        }
        try {
          const result = await client.call("agent_turn.get", turnRequest(leaf));
          if (cancelled) return;
          if (!client.isCurrent()) continue;
          fetched.current.set(identity, trigger);
          due.current.delete(identity);
          // Only the session this card shows may publish a receipt to it; the
          // next observation names the replacement session.
          failures.current.delete(identity);
          if (!answersSession(result, leaf)) continue;
          const turn = (result as { turn?: unknown } | null)?.turn;
          setReceipts((current) =>
            new Map(current).set(
              identity,
              receiptAfterRead(isReceipt(turn) ? turn : null, trigger),
            ),
          );
        } catch {
          if (cancelled) return;
          if (!client.isCurrent()) continue;
          fetched.current.set(identity, trigger);
          due.current.delete(identity);
          const failed = failures.current.get(identity);
          const count = failed?.trigger === trigger ? failed.count + 1 : 1;
          failures.current.set(identity, { trigger, count });
          setReceipts((current) =>
            new Map(current).set(
              identity,
              receiptAfterError(current.get(identity), trigger, count),
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // requestKeys captures every identity and trigger; tick marks all due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, requestKeys, tick]);

  const polled = new Set(targets.map(receiptIdentity));
  // Agents outside the polling bound have no receipt rather than a pending one.
  return useCallback(
    (leaf: WorldLeafObject): ReceiptState => {
      const identity = receiptIdentity(leaf);
      return receiptStateOf(receipts.get(identity), leaf, polled.has(identity));
    },
    // requestKeys covers the polled set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receipts, requestKeys],
  );
}

function handledKey(connectionId: string) {
  return `handoffs.handled.v1.${connectionId}`;
}

function readHandled(connectionId: string): string[] {
  try {
    const value = JSON.parse(
      worldLocalStorage.getItem(handledKey(connectionId)) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

// Every mounted consumer shares one in-memory list per connection.
const handledListeners = new Set<() => void>();

/** Browser-local "handled" marks for individual turn receipts. */
export function useHandledTurns(connectionId: string) {
  const [handled, setHandled] = useState<string[]>(() =>
    readHandled(connectionId),
  );
  useEffect(() => {
    setHandled(readHandled(connectionId));
    const sync = () => setHandled(readHandled(connectionId));
    handledListeners.add(sync);
    return () => {
      handledListeners.delete(sync);
    };
  }, [connectionId]);
  const set = useMemo(() => new Set(handled), [handled]);
  const mark = useCallback(
    (turnId: string, value: boolean) => {
      const current = readHandled(connectionId);
      const next = value
        ? [...current.filter((id) => id !== turnId), turnId].slice(
            -HANDLED_LIMIT,
          )
        : current.filter((id) => id !== turnId);
      try {
        worldLocalStorage.setItem(
          handledKey(connectionId),
          JSON.stringify(next),
        );
      } catch {
        // Handled marks are a browser convenience; queues still work.
      }
      setHandled(next);
      for (const listener of handledListeners) listener();
    },
    [connectionId],
  );
  return { handled: set, mark };
}

function stopsKey(connectionId: string) {
  return `handoffs.stops.v2.${connectionId}`;
}

/**
 * When this browser saw each agent stop working. Herdr reports lifecycle but
 * not when it changed, and some agents have no readable transcript, so the
 * observed transition is what dates a fresh stop for review.
 */
export function useObservedStops(
  connectionId: string,
  leaves: WorldLeafObject[],
): Map<string, number> {
  const previous = useRef(new Map<string, string>());
  const [stops, setStops] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    previous.current = new Map();
    try {
      const saved = JSON.parse(
        worldLocalStorage.getItem(stopsKey(connectionId)) ?? "{}",
      ) as Record<string, unknown>;
      setStops(
        new Map(
          Object.entries(saved).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        ),
      );
    } catch {
      setStops(new Map());
    }
  }, [connectionId]);
  const statusKey = leaves
    .map((leaf) => `${receiptIdentity(leaf)}=${leaf.status}`)
    .join("\n");
  useEffect(() => {
    const now = Date.now();
    const result = advanceObservedStops(stops, previous.current, leaves, now);
    const next = result.stops;
    const changed = result.changed;
    if (!changed) return;
    setStops(next);
    try {
      worldLocalStorage.setItem(
        stopsKey(connectionId),
        JSON.stringify(Object.fromEntries(next)),
      );
    } catch {
      // Observed stops are a browser convenience.
    }
    // statusKey captures every status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, statusKey]);
  return stops;
}

/** Fetches one agent's complete closing report for reading in full. */
/** The request for one agent's latest turn, qualified by its session. */
function turnRequest(leaf: WorldLeafObject, fullReport = false) {
  return {
    pane_id: leaf.pane.pane_id,
    workspace_id: leaf.pane.workspace_id,
    tab_id: leaf.pane.tab_id,
    agent: leaf.pane.agent,
    ...(leaf.agentSessionFingerprint
      ? { agent_session_fingerprint: leaf.agentSessionFingerprint }
      : {}),
    ...(fullReport ? { full_report: true } : {}),
  };
}

/** Whether a turn response belongs to the agent session the caller shows. */
export function answersSession(result: unknown, leaf: WorldLeafObject) {
  const response = result as {
    session_changed?: unknown;
    agent_session_fingerprint?: unknown;
  } | null;
  if (!response || response.session_changed === true) return false;
  return (
    !leaf.agentSessionFingerprint ||
    response.agent_session_fingerprint === leaf.agentSessionFingerprint
  );
}

/**
 * Fetches the complete closing report of the stop a card shows. A newer stop
 * or another session yields nothing, so a card never pairs one stop's request
 * and files with another stop's report.
 */
export async function fetchFullReport(
  clients: DeskClients,
  leaf: WorldLeafObject,
  expectedTurnId: string,
): Promise<string | null> {
  const client = deskClient(clients, leaf);
  if (!client) return null;
  const result = await client.call("agent_turn.get", turnRequest(leaf, true));
  if (!client.isCurrent()) return null;
  if (!answersSession(result, leaf)) return null;
  const turn = (result as { turn?: unknown } | null)?.turn;
  return isReceipt(turn) && turn.turn_id === expectedTurnId
    ? turn.report
    : null;
}

const OPENS_LIMIT = 40;

function opensKey(connectionId: string) {
  return `desk.opened.v1.${connectionId}`;
}

/**
 * When the operator last opened each agent session from the Desk, so the
 * agents they recently worked with stay one tap away after review.
 */
export function useRecentOpens(connectionId: string) {
  const read = useCallback((): Map<string, number> => {
    try {
      const saved = JSON.parse(
        worldLocalStorage.getItem(opensKey(connectionId)) ?? "{}",
      ) as Record<string, unknown>;
      return new Map(
        Object.entries(saved).filter(
          (entry): entry is [string, number] => typeof entry[1] === "number",
        ),
      );
    } catch {
      return new Map();
    }
  }, [connectionId]);
  const [opens, setOpens] = useState<Map<string, number>>(read);
  useEffect(() => setOpens(read()), [read]);
  const record = useCallback(
    (leaf: WorldLeafObject) => {
      const next = new Map(read());
      next.set(receiptIdentity(leaf), Date.now());
      const kept = new Map(
        [...next]
          .sort((left, right) => right[1] - left[1])
          .slice(0, OPENS_LIMIT),
      );
      try {
        worldLocalStorage.setItem(
          opensKey(connectionId),
          JSON.stringify(Object.fromEntries(kept)),
        );
      } catch {
        // Recent opens are a browser convenience.
      }
      setOpens(kept);
    },
    [connectionId, read],
  );
  return { opens, record };
}
