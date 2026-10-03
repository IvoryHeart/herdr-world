import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionClient } from "../api";
import { worldLocalStorage } from "../browserStorage";
import type { WorldLeafObject, WorldObject } from "./worldObject";

/** Mirrors the service's `TurnReceipt` (server/src/agent/turn-receipt.ts). */
export type TurnReceipt = {
  turn_id: string;
  ask: string | null;
  report: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  tool_calls: number;
  commands: number;
  files: string[];
  files_truncated: boolean;
};

const MAX_AGENTS = 40;
const REFRESH_MS = 20_000;
const HANDLED_LIMIT = 500;
// An idle agent hands something back only right after its turn; older idle
// sessions are history, not work waiting for review.
export const IDLE_WINDOW_MS = 12 * 60 * 60_000;

/** Agents on the selected host that can be acted on now. */
export function operationalAgents(world: WorldObject): WorldLeafObject[] {
  return world.leaves
    .filter(
      (leaf) =>
        leaf.kind === "agent" &&
        leaf.selectedHost &&
        leaf.actionable &&
        !leaf.stale,
    )
    .slice(0, MAX_AGENTS);
}

export function receiptRequestKey(leaf: WorldLeafObject) {
  return JSON.stringify([
    leaf.id,
    leaf.generation,
    leaf.agentSessionFingerprint ?? null,
    leaf.status,
    leaf.lastActivityAt ?? null,
  ]);
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
 * Latest turn receipt per agent, keyed by `receiptRequestKey`. A receipt is
 * fetched again whenever the agent's state or activity changes and on a slow
 * interval so transcript writes that land after a state change are seen.
 */
export function useTurnReceipts(
  leaves: WorldLeafObject[],
  client: ConnectionClient,
) {
  const [receipts, setReceipts] = useState<Map<string, TurnReceipt | null>>(
    () => new Map(),
  );
  const [tick, setTick] = useState(0);
  const requestKeys = leaves.map(receiptRequestKey).join("\n");

  useEffect(() => setReceipts(new Map()), [client.connectionId]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const leaf of leaves) {
        if (cancelled || !client.isCurrent()) return;
        if (!leaf.pane.agent) continue;
        const key = receiptRequestKey(leaf);
        try {
          const result = await client.call("agent_turn.get", {
            pane_id: leaf.pane.pane_id,
            workspace_id: leaf.pane.workspace_id,
            tab_id: leaf.pane.tab_id,
            agent: leaf.pane.agent,
          });
          const turn = (result as { turn?: unknown } | null)?.turn;
          if (cancelled || !client.isCurrent()) return;
          setReceipts((current) =>
            new Map(current).set(key, isReceipt(turn) ? turn : null),
          );
        } catch {
          if (!cancelled)
            setReceipts((current) => new Map(current).set(key, null));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // requestKeys captures every leaf change; tick refreshes transcripts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, requestKeys, tick]);

  return useCallback(
    (leaf: WorldLeafObject) => receipts.get(receiptRequestKey(leaf)),
    [receipts],
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
  return `handoffs.stops.v1.${connectionId}`;
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
    .map((leaf) => `${leaf.id}=${leaf.status}`)
    .join("\n");
  useEffect(() => {
    const now = Date.now();
    let changed = false;
    const next = new Map(stops);
    for (const leaf of leaves) {
      const before = previous.current.get(leaf.id);
      if (before === "working" && leaf.status !== "working") {
        next.set(leaf.id, now);
        changed = true;
      } else if (leaf.status === "working" && next.delete(leaf.id)) {
        changed = true;
      }
      previous.current.set(leaf.id, leaf.status);
    }
    for (const [id, at] of next)
      if (now - at > IDLE_WINDOW_MS && next.delete(id)) changed = true;
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
