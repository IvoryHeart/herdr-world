import { useEffect, useRef, useState } from "react";
import { bridge } from "../../api";
import type { BinEntry, BinOutcome } from "../../../../shared/bin";
import { useWorldBin, worldBinStore } from "./binStore";
import { playBinCloseSound } from "./binSounds";
import "./bin.css";
import { WorldBinTray } from "./WorldBinTray";

/** What the view is dragging towards the bin, if anything. */
export type BinDrag = {
  label: string;
  /** Why this one can't go in (a pinned tab, an unreachable host). */
  refusal: string | null;
  working: boolean;
  /** Panes its tab keeps after this one closes. */
  keeps: number;
};

const RING = 2 * Math.PI * 40;

/** One line for a close's result, as the bin and the bus report it. */
export function binOutcomeText(outcome: BinOutcome) {
  if (outcome.result === "closed")
    return outcome.closed_tab
      ? `Closed ${outcome.label} and its tab.`
      : `Closed ${outcome.label}'s pane.`;
  if (outcome.result === "gone")
    return `${outcome.label} was not closed. ${outcome.detail ?? ""}`.trim();
  if (outcome.result === "uncertain")
    return `${outcome.label} may have closed; World is checking and won't send it again.`;
  return `Couldn't close ${outcome.label}. ${outcome.detail ?? ""}`.trim();
}

/**
 * The plain bin: shown while a card is dragged or while it holds anything. A
 * ring drains to the next close. Clicking it pauses every timer and opens it;
 * Put back, Close now, Close all now and Close lid are the visible controls,
 * and dragging a card out of the open bin puts it back.
 */
export function WorldBin({
  drag,
  hot,
  shake = 0,
  className,
  onDragOut,
  onReturned,
}: {
  drag: BinDrag | null;
  hot: boolean;
  /** Bumped when a drop is refused, to shake the bin. */
  shake?: number;
  className?: string;
  /** A card is being dragged out of the open bin (null when it ends). */
  onDragOut?: (entry: BinEntry | null) => void;
  /** An agent came back out; `at` is where it was dropped, if dragged. */
  onReturned?: (entry: BinEntry, at: { x: number; y: number } | null) => void;
}) {
  const store = worldBinStore(bridge);
  const bin = useWorldBin(store);
  // The service owns the hold. Every view presents its one shared tray.
  const open = bin.paused;
  const [toast, setToast] = useState<string | null>(null);
  const [pulse, setPulse] = useState<"gulp" | "close" | "refuse" | null>(null);
  const [, tick] = useState(0);
  const count = useRef(bin.entries.length);
  const holding = bin.entries.length > 0;

  useEffect(() => {
    if (!holding || bin.paused) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [holding, bin.paused]);

  useEffect(() => {
    if (bin.entries.length > count.current) setPulse("gulp");
    count.current = bin.entries.length;
  }, [bin.entries.length]);

  useEffect(() => {
    if (shake) setPulse("refuse");
  }, [shake]);

  useEffect(
    () =>
      store.onOutcome((outcome) => {
        if (outcome.result === "closed") {
          playBinCloseSound();
          setPulse("close");
        }
        setToast(binOutcomeText(outcome));
      }),
    [store],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), 800);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const next = bin.entries.reduce<BinEntry | null>(
    (soonest, entry) =>
      !soonest || store.remaining(entry) < store.remaining(soonest)
        ? entry
        : soonest,
    null,
  );
  const left = next ? store.remaining(next) : 0;
  // The ring runs down through the wait and the bus's drive away together.
  const fraction = next
    ? Math.min(1, left / Math.max(1, next.duration_ms + next.departure_ms))
    : 0;
  const refused = !!drag?.refusal;
  const label = drag
    ? drag.refusal
      ? drag.refusal
      : hot
        ? drag.working
          ? `${drag.label} is working. Drop anyway?`
          : "Release to bin"
        : drag.keeps > 0
          ? `Drop to close this pane · tab keeps ${drag.keeps}`
          : "Drop to close"
    : bin.paused
      ? "Held · Resume in tray"
      : bin.entries.length > 1
        ? `${bin.entries.length} agents · tap to open`
        : next
          ? `${next.label} · tap to open`
          : "Drop to close";

  const report = (text: string) => setToast(text);
  const toggle = () => {
    if (!holding || !bin.verified) return;
    void (open ? store.resume() : store.pause()).catch((error) =>
      report(String(error?.message ?? error)),
    );
  };
  const putBack = (entry: BinEntry, at: { x: number; y: number } | null) => {
    void store.restore(entry.id).then(
      () => {
        report(`${entry.label} is back in its place.`);
        onReturned?.(entry, at);
      },
      (error) => report(String(error?.message ?? error)),
    );
  };
  // Only what this page shows, and only while it shows the live bin.
  const closeNow = (ids: readonly string[]) => {
    if (!bin.verified) return report("The bin is reconnecting; try again.");
    void store
      .closeNow(ids)
      .catch((error) => report(String(error?.message ?? error)));
  };

  return (
    <>
      <div
        className={[
          "world-bin",
          className,
          drag || holding ? "world-bin-shown" : "",
          holding ? "world-bin-holding" : "",
          hot && !refused ? "world-bin-hot" : "",
          refused ? "world-bin-refused" : "",
          bin.paused ? "world-bin-paused" : "",
          pulse ? `world-bin-${pulse}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="world-bin"
      >
        <button
          type="button"
          className="world-bin-can"
          aria-label={
            holding
              ? `Bin: ${bin.entries.length} waiting to close${bin.paused ? ", held" : ""}. ${open ? "Close lid" : "Open"}`
              : "Bin"
          }
          aria-expanded={holding ? open : undefined}
          onClick={toggle}
          tabIndex={holding ? 0 : -1}
        >
          <svg
            className="world-bin-ring"
            viewBox="0 0 84 92"
            aria-hidden="true"
          >
            <circle className="world-bin-track" cx="42" cy="46" r="40" />
            <circle
              className="world-bin-progress"
              cx="42"
              cy="46"
              r="40"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - fraction)}
            />
          </svg>
          <span className="world-bin-peek" aria-hidden="true" />
          <svg
            className="world-bin-body"
            viewBox="0 0 64 76"
            aria-hidden="true"
          >
            <g className="world-bin-lid">
              <rect x="4" y="10" width="56" height="7" rx="2" />
              <rect
                x="24"
                y="4"
                width="16"
                height="6"
                rx="2"
                className="world-bin-handle"
              />
            </g>
            <path className="world-bin-shell" d="M9 20h46l-4 52H13z" />
            <path className="world-bin-ribs" d="M24 30v34M32 30v34M40 30v34" />
          </svg>
          {holding && (
            <span className="world-bin-seconds">{Math.ceil(left / 1000)}s</span>
          )}
          {pulse === "close" && (
            <span className="world-bin-dust" aria-hidden="true" />
          )}
        </button>
        <small className="world-bin-label">{label}</small>
      </div>
      {open && holding && (
        <WorldBinTray
          entries={bin.entries}
          paused={bin.paused}
          timeLeft={(entry) => store.remaining(entry)}
          onShut={toggle}
          onPutBack={putBack}
          onCloseNow={closeNow}
          onDragOut={onDragOut}
          className={className}
        />
      )}
      {toast && (
        <div
          className={["world-bin-toast", className].filter(Boolean).join(" ")}
          role="status"
        >
          {toast}
        </div>
      )}
    </>
  );
}
