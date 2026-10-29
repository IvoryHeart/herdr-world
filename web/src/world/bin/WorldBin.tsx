import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { BinEntry } from "../../../../shared/bin";
import {
  binOutcomeText,
  binTimeLeft,
  closeFromBin,
  onBinOutcome,
  pauseBin,
  restoreFromBin,
  resumeBin,
  useWorldBin,
} from "./binStore";
import { playBinSound } from "./binSounds";
import "./bin.css";

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
  const current = useWorldBin();
  const { bin } = current;
  const [open, setOpen] = useState(false);
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
    if (!bin.entries.length) setOpen(false);
  }, [bin.entries.length]);

  useEffect(() => {
    if (shake) setPulse("refuse");
  }, [shake]);

  useEffect(
    () =>
      onBinOutcome((outcome) => {
        if (outcome.result === "closed") {
          playBinSound("close");
          setPulse("close");
        }
        setToast(binOutcomeText(outcome));
      }),
    [],
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

  // Another World closing the lid closes it here too.
  useEffect(() => {
    if (!bin.paused) setOpen(false);
  }, [bin.paused]);

  const next = bin.entries.reduce<BinEntry | null>(
    (soonest, entry) =>
      !soonest || binTimeLeft(entry, current) < binTimeLeft(soonest, current)
        ? entry
        : soonest,
    null,
  );
  const left = next ? binTimeLeft(next, current) : 0;
  const fraction = next ? Math.min(1, left / Math.max(1, next.duration_ms)) : 0;
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
      ? "Paused · drag one out"
      : bin.entries.length > 1
        ? `${bin.entries.length} agents · tap to open`
        : next
          ? `${next.label} · tap to open`
          : "Drop to close";

  const report = (text: string) => setToast(text);
  const toggle = () => {
    if (!holding) return;
    if (open) {
      setOpen(false);
      void resumeBin().catch((error) =>
        report(String(error?.message ?? error)),
      );
    } else {
      setOpen(true);
      void pauseBin().catch((error) => report(String(error?.message ?? error)));
    }
  };
  const putBack = (entry: BinEntry, at: { x: number; y: number } | null) => {
    playBinSound("back");
    void restoreFromBin(entry.id).then(
      () => {
        report(`${entry.label} is back in its place.`);
        onReturned?.(entry, at);
      },
      (error) => report(String(error?.message ?? error)),
    );
  };
  const closeNow = (id: string) =>
    void closeFromBin(id).catch((error) =>
      report(String(error?.message ?? error)),
    );

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
              ? `Bin: ${bin.entries.length} waiting to close${bin.paused ? ", paused" : ""}. ${open ? "Close lid" : "Open"}`
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
        <BinTray
          entries={bin.entries}
          timeLeft={(entry) => binTimeLeft(entry, current)}
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

function BinTray({
  entries,
  timeLeft,
  onShut,
  onPutBack,
  onCloseNow,
  onDragOut,
  className,
}: {
  entries: readonly BinEntry[];
  timeLeft: (entry: BinEntry) => number;
  onShut: () => void;
  onPutBack: (entry: BinEntry, at: { x: number; y: number } | null) => void;
  onCloseNow: (id: string) => void;
  onDragOut?: (entry: BinEntry | null) => void;
  className?: string;
}) {
  const tray = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState<{
    entry: BinEntry;
    x: number;
    y: number;
  } | null>(null);

  const startDrag = (entry: BinEntry, event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLifted({ entry, x: event.clientX, y: event.clientY });
    onDragOut?.(entry);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!lifted) return;
    setLifted({ ...lifted, x: event.clientX, y: event.clientY });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!lifted) return;
    const { entry } = lifted;
    setLifted(null);
    onDragOut?.(null);
    const rect = tray.current?.getBoundingClientRect();
    const inside =
      !rect ||
      (event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom);
    if (cancelled || inside) return;
    onPutBack(entry, { x: event.clientX, y: event.clientY });
  };

  return (
    <div
      ref={tray}
      className={["world-bin-tray", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-label="Bin contents"
    >
      <header>
        <b>Bin · paused</b>
        <small>{entries.length} inside</small>
        <button type="button" className="world-bin-button" onClick={onShut}>
          Close lid
        </button>
      </header>
      <p className="world-bin-hint">
        Drag a card out to put it back where it was. The timers continue when
        you close the lid.
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <div
              className={[
                "world-bin-card",
                lifted?.entry.id === entry.id ? "world-bin-card-lifting" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-bin-entry={entry.id}
              onPointerDown={(event) => startDrag(entry, event)}
              onPointerMove={moveDrag}
              onPointerUp={(event) => endDrag(event)}
              onPointerCancel={(event) => endDrag(event, true)}
            >
              <b>{entry.label}</b>
              <code>{Math.ceil(timeLeft(entry) / 1000)}s</code>
              <button
                type="button"
                className="world-bin-button"
                onClick={() => onPutBack(entry, null)}
              >
                Put back
              </button>
              <button
                type="button"
                className="world-bin-button world-bin-danger"
                onClick={() => onCloseNow(entry.id)}
              >
                Close now
              </button>
            </div>
          </li>
        ))}
      </ul>
      {entries.length > 1 && (
        <footer>
          <button
            type="button"
            className="world-bin-button world-bin-danger"
            onClick={() => onCloseNow("all")}
          >
            Close all now
          </button>
        </footer>
      )}
      {lifted && (
        <div
          className="world-bin-card world-bin-card-lifted"
          style={{ left: lifted.x - 40, top: lifted.y - 16 }}
          aria-hidden="true"
        >
          <b>{lifted.entry.label}</b>
        </div>
      )}
    </div>
  );
}
