import { useRef, useState, type PointerEvent } from "react";
import type { BinEntry } from "../../../../shared/bin";
import "./bin.css";

/** One tray renderer for Board, Desk and Town; only its anchor differs. */
export function WorldBinTray({
  entries,
  paused,
  timeLeft,
  onShut,
  onPutBack,
  onCloseNow,
  onDragOut,
  className,
}: {
  entries: readonly BinEntry[];
  /** The service's pause, not this click's wish. */
  paused: boolean;
  timeLeft: (entry: BinEntry) => number;
  onShut: () => void;
  onPutBack: (entry: BinEntry, at: { x: number; y: number } | null) => void;
  onCloseNow: (ids: readonly string[]) => void;
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
      data-testid="bin-tray"
      role="dialog"
      aria-label="Bin contents"
    >
      <header>
        <b>{paused ? "Bin · held" : "Bin · pausing…"}</b>
        <small>
          {entries.length} inside
          {entries.some((entry) => timeLeft(entry) < entry.departure_ms)
            ? " · departure held"
            : ""}
        </small>
        <button
          type="button"
          className="world-bin-button world-bin-resume"
          title="Resume countdown and close lid"
          onClick={onShut}
        >
          Resume
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
                onClick={() => onCloseNow([entry.id])}
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
            onClick={() => onCloseNow(entries.map((entry) => entry.id))}
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
