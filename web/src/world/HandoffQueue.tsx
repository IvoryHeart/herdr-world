import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ConnectionClient } from "../api";
import { worldLocalStorage } from "../browserStorage";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import "./HandoffQueue.css";

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

type Handoff = {
  leaf: WorldLeafObject;
  receipt: TurnReceipt | null;
  handled: boolean;
};

const MAX_AGENTS = 40;
const REFRESH_MS = 20_000;
const HANDLED_LIMIT = 500;
// An idle agent hands something back only right after its turn; older idle
// sessions are history, not work waiting for review.
const IDLE_WINDOW_MS = 12 * 60 * 60_000;
const STATUS_ORDER = { blocked: 0, done: 1, idle: 2 } as const;
const STATUS_LABEL = { blocked: "Needs you", done: "Done", idle: "Idle" };

type HandoffStatus = keyof typeof STATUS_ORDER;

function isHandoffStatus(status: string): status is HandoffStatus {
  return status in STATUS_ORDER;
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

function isReceipt(value: unknown): value is TurnReceipt {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TurnReceipt).turn_id === "string" &&
    Array.isArray((value as TurnReceipt).files)
  );
}

export function handoffCandidates(world: WorldObject): WorldLeafObject[] {
  return world.leaves
    .filter(
      (leaf) =>
        leaf.kind === "agent" &&
        leaf.selectedHost &&
        leaf.actionable &&
        !leaf.stale &&
        !!leaf.pane.agent &&
        isHandoffStatus(leaf.status),
    )
    .slice(0, MAX_AGENTS);
}

function receiptRequestKey(leaf: WorldLeafObject) {
  return JSON.stringify([
    leaf.id,
    leaf.generation,
    leaf.agentSessionFingerprint ?? null,
    leaf.status,
    leaf.lastActivityAt ?? null,
  ]);
}

export function isRecent(receipt: TurnReceipt | null, now: number) {
  const ended = Date.parse(receipt?.ended_at ?? "");
  return Number.isFinite(ended) && now - ended <= IDLE_WINDOW_MS;
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

/** Orders unhandled stops first: questions, then results, oldest waiting first. */
export function orderHandoffs(handoffs: Handoff[]) {
  const ended = (handoff: Handoff) =>
    Date.parse(handoff.receipt?.ended_at ?? "") ||
    handoff.leaf.lastActivityAt ||
    0;
  return [...handoffs].sort(
    (left, right) =>
      Number(left.handled) - Number(right.handled) ||
      STATUS_ORDER[left.leaf.status as HandoffStatus] -
        STATUS_ORDER[right.leaf.status as HandoffStatus] ||
      ended(left) - ended(right),
  );
}

export function HandoffQueue({
  world,
  client,
  portal,
  onOpenTerminal,
}: {
  world: WorldObject;
  client: ConnectionClient;
  portal: HTMLElement | null;
  onOpenTerminal(id: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Map<string, TurnReceipt | null>>(
    () => new Map(),
  );
  const [handled, setHandled] = useState<string[]>(() =>
    readHandled(client.connectionId),
  );
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const candidates = useMemo(() => handoffCandidates(world), [world]);
  const requestKeys = candidates.map(receiptRequestKey).join("\n");

  useEffect(() => {
    setHandled(readHandled(client.connectionId));
    setReceipts(new Map());
  }, [client.connectionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      setTick((value) => value + 1);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const leaf of candidates) {
        if (cancelled || !client.isCurrent()) return;
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
    // requestKeys captures every candidate change; tick refreshes transcripts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, requestKeys, tick]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const handledSet = useMemo(() => new Set(handled), [handled]);
  const handoffs = orderHandoffs(
    candidates.flatMap((leaf) => {
      const receipt = receipts.get(receiptRequestKey(leaf)) ?? null;
      if (leaf.status === "idle" && !isRecent(receipt, now)) return [];
      return [
        {
          leaf,
          receipt,
          handled: receipt ? handledSet.has(receipt.turn_id) : false,
        },
      ];
    }),
  );
  const pending = handoffs.filter((handoff) => !handoff.handled);
  const waitingOnYou = pending.filter(
    (handoff) => handoff.leaf.status === "blocked",
  ).length;
  const visible = showHandled ? handoffs : pending;

  const setHandledFor = (turnId: string, value: boolean) => {
    setHandled((current) => {
      const next = value
        ? [...current.filter((id) => id !== turnId), turnId].slice(
            -HANDLED_LIMIT,
          )
        : current.filter((id) => id !== turnId);
      try {
        worldLocalStorage.setItem(
          handledKey(client.connectionId),
          JSON.stringify(next),
        );
      } catch {
        // Handled marks are a browser convenience; the queue still works.
      }
      return next;
    });
  };

  if (!portal) return null;
  return createPortal(
    <div className="world-handoffs">
      <button
        type="button"
        className={`world-handoffs-trigger${waitingOnYou ? " has-questions" : ""}`}
        aria-expanded={open}
        aria-controls="world-handoffs-panel"
        onClick={() => setOpen((value) => !value)}
      >
        Handoffs
        <span
          className="world-handoffs-count"
          aria-label={`${pending.length} to review`}
        >
          {pending.length}
        </span>
      </button>
      {open ? (
        <div
          className="world-handoffs-panel"
          id="world-handoffs-panel"
          role="dialog"
          aria-label="Handoffs"
        >
          <header className="world-handoffs-header">
            <div>
              <strong>Handoffs</strong>
              <span>
                {pending.length
                  ? `${pending.length} to review${waitingOnYou ? ` · ${waitingOnYou} waiting on you` : ""}`
                  : "Nothing waiting on you"}
              </span>
            </div>
            <label className="world-handoffs-toggle">
              <input
                type="checkbox"
                checked={showHandled}
                onChange={(event) => setShowHandled(event.target.checked)}
              />
              Show handled
            </label>
          </header>
          {visible.length === 0 ? (
            <p className="world-handoffs-empty">
              When an agent finishes or stops to ask you something, its turn
              lands here with what you asked, what it reported and what it
              touched.
            </p>
          ) : (
            <ol className="world-handoffs-list">
              {visible.map(({ leaf, receipt, handled: isHandled }) => {
                const status = leaf.status as HandoffStatus;
                const ended = Date.parse(receipt?.ended_at ?? "");
                const waited = Number.isFinite(ended)
                  ? formatSpan(now - ended)
                  : null;
                const ran = formatSpan(receipt?.duration_ms ?? null);
                const isExpanded = expanded === leaf.id;
                return (
                  <li
                    key={leaf.id}
                    className={`world-handoff is-${status}${isHandled ? " is-handled" : ""}`}
                  >
                    <div className="world-handoff-head">
                      <span className="world-handoff-status">
                        {STATUS_LABEL[status]}
                      </span>
                      <span className="world-handoff-who">
                        {leaf.agentLabel ?? leaf.label}
                        <small>
                          {leaf.spaceLabel}
                          {leaf.tabLabel ? ` › ${leaf.tabLabel}` : ""}
                        </small>
                      </span>
                      {waited ? (
                        <span className="world-handoff-waited">
                          {status === "blocked" ? "waiting" : "ended"} {waited}{" "}
                          ago
                        </span>
                      ) : null}
                    </div>
                    {receipt ? (
                      <>
                        {receipt.ask ? (
                          <p className="world-handoff-ask">
                            <span>You asked</span>
                            {receipt.ask}
                          </p>
                        ) : null}
                        {receipt.report ? (
                          <p
                            className={`world-handoff-report${isExpanded ? " is-expanded" : ""}`}
                          >
                            {receipt.report}
                          </p>
                        ) : (
                          <p className="world-handoff-report is-missing">
                            No closing message yet; open the terminal to see
                            where it stopped.
                          </p>
                        )}
                        {receipt.report && receipt.report.length > 280 ? (
                          <button
                            type="button"
                            className="world-handoff-more"
                            onClick={() =>
                              setExpanded(isExpanded ? null : leaf.id)
                            }
                          >
                            {isExpanded ? "Show less" : "Show all"}
                          </button>
                        ) : null}
                        <p className="world-handoff-facts">
                          {[
                            ran ? `ran ${ran}` : null,
                            `${receipt.tool_calls} tool call${receipt.tool_calls === 1 ? "" : "s"}`,
                            receipt.commands
                              ? `${receipt.commands} command${receipt.commands === 1 ? "" : "s"}`
                              : null,
                            `${receipt.files.length}${receipt.files_truncated ? "+" : ""} file${receipt.files.length === 1 ? "" : "s"} edited`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {receipt.files.length ? (
                          <ul className="world-handoff-files">
                            {receipt.files.slice(0, 6).map((path) => (
                              <li key={path} title={path}>
                                {path.split("/").pop()}
                              </li>
                            ))}
                            {receipt.files.length > 6 ? (
                              <li>+{receipt.files.length - 6}</li>
                            ) : null}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <p className="world-handoff-report is-missing">
                        {leaf.taskSummary ??
                          "No readable session for this agent; open its terminal."}
                      </p>
                    )}
                    <div className="world-handoff-actions">
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => {
                          setOpen(false);
                          void onOpenTerminal(leaf.id).catch(() => {});
                        }}
                      >
                        {status === "blocked" ? "Answer" : "Open terminal"}
                      </button>
                      {receipt ? (
                        <button
                          type="button"
                          onClick={() =>
                            setHandledFor(receipt.turn_id, !isHandled)
                          }
                        >
                          {isHandled ? "Reopen" : "Mark handled"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </div>,
    portal,
  );
}
