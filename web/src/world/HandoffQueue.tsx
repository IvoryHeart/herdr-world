import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ConnectionClient } from "../api";
import {
  formatSpan,
  isRecent,
  operationalAgents,
  receiptEndedAt,
  useHandledTurns,
  useNow,
  useTurnReceipts,
} from "./handoffs";
import type { WorldObject } from "./worldObject";
import "./HandoffQueue.css";

/**
 * Compact access to what agents handed back, for the spatial views. The Desk
 * view presents the same queue as the primary workspace.
 */
export function HandoffQueue({
  world,
  client,
  portal,
  onOpenTerminal,
  onOpenDesk,
}: {
  world: WorldObject;
  client: ConnectionClient;
  portal: HTMLElement | null;
  onOpenTerminal(id: string): Promise<void>;
  onOpenDesk(): void;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const agents = useMemo(
    () =>
      operationalAgents(world).filter((leaf) =>
        ["blocked", "done", "idle"].includes(leaf.status),
      ),
    [world],
  );
  const receiptFor = useTurnReceipts(agents, client);
  const { handled, mark } = useHandledTurns(client.connectionId);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const items = agents
    .map((leaf) => ({ leaf, receipt: receiptFor(leaf) ?? null }))
    .filter(
      ({ leaf, receipt }) =>
        leaf.status === "blocked" ||
        leaf.status === "done" ||
        isRecent(receipt, now),
    )
    .filter(
      ({ leaf, receipt }) =>
        leaf.status === "blocked" || !receipt || !handled.has(receipt.turn_id),
    )
    .sort(
      (left, right) =>
        Number(right.leaf.status === "blocked") -
          Number(left.leaf.status === "blocked") ||
        (receiptEndedAt(left.receipt) ?? 0) -
          (receiptEndedAt(right.receipt) ?? 0),
    );
  const waitingOnYou = items.filter(
    ({ leaf }) => leaf.status === "blocked",
  ).length;

  if (!portal) return null;
  return createPortal(
    <div className="world-handoffs">
      <button
        type="button"
        className={`world-handoffs-trigger${waitingOnYou ? " has-questions" : ""}`}
        aria-expanded={open}
        aria-controls="world-handoffs-panel"
        aria-label={`Handoffs: ${items.length} to review${waitingOnYou ? `, ${waitingOnYou} waiting on you` : ""}`}
        title="Handoffs"
        onClick={() => setOpen((value) => !value)}
      >
        {/* Compact so the visual-view toolbar keeps room for search. */}
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 9.5V12.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5M2 9.5 3.6 3.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L14 9.5M2 9.5h3.2l.8 1.6h4l.8-1.6H14" />
        </svg>
        <span className="world-handoffs-count" aria-hidden="true">
          {items.length}
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
                {items.length
                  ? `${items.length} to review${waitingOnYou ? ` · ${waitingOnYou} waiting on you` : ""}`
                  : "Nothing waiting on you"}
              </span>
            </div>
            <button
              type="button"
              className="world-handoffs-desk"
              onClick={() => {
                setOpen(false);
                onOpenDesk();
              }}
            >
              Open Desk
            </button>
          </header>
          {items.length === 0 ? (
            <p className="world-handoffs-empty">
              When an agent finishes or stops to ask you something, its turn
              lands here with what you asked, what it reported and what it
              touched.
            </p>
          ) : (
            <ol className="world-handoffs-list">
              {items.map(({ leaf, receipt }) => {
                const status = leaf.status === "blocked" ? "blocked" : "done";
                const ended = receiptEndedAt(receipt);
                const waited = ended === null ? null : formatSpan(now - ended);
                return (
                  <li key={leaf.id} className={`world-handoff is-${status}`}>
                    <div className="world-handoff-head">
                      <span className="world-handoff-status">
                        {status === "blocked" ? "Needs you" : "Done"}
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
                          {waited} ago
                        </span>
                      ) : null}
                    </div>
                    {receipt?.ask ? (
                      <p className="world-handoff-ask">
                        <span>You asked</span>
                        {receipt.ask}
                      </p>
                    ) : null}
                    <p
                      className={`world-handoff-report${receipt?.report ? "" : " is-missing"}`}
                    >
                      {receipt?.report ??
                        "Open the terminal to see where it stopped."}
                    </p>
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
                      {receipt && status !== "blocked" ? (
                        <button
                          type="button"
                          onClick={() => mark(receipt.turn_id, true)}
                        >
                          Mark reviewed
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
