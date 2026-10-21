import { useState, useSyncExternalStore } from "react";
import type { TraceEntry, ViewTrace } from "./flag";
import type { TracedView } from "./trace";
import { TRACE_STYLES } from "./traceStyles";

/**
 * A view's event trace on screen: the current gesture, the pointers down,
 * and the newest entries. Copy trace puts the whole ring on the clipboard for
 * a bug report; it can be replayed as a test. Development builds only.
 */
export function TraceOverlay({
  view,
  trace,
  status,
  onClose,
}: {
  view: TracedView;
  trace: ViewTrace;
  /** The gesture machine's state, read when the trace changes. */
  status: () => { mode: string; pointers: number };
  onClose(): void;
}) {
  const count = useSyncExternalStore(
    trace.subscribe,
    () => {
      const list = trace.entries();
      return list.length + (list[list.length - 1]?.t ?? 0);
    },
    () => 0,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const entries = trace.entries().slice(-14).reverse();
  const now = status();
  const copy = async () => {
    const text = trace.export({
      view,
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      gesture: now,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied");
    } catch {
      // No clipboard (plain HTTP): show the text to copy by hand.
      setCopied(text);
    }
  };
  void count;
  return (
    <div
      className="world-trace"
      role="log"
      aria-label={`${view === "board" ? "Board" : "Town"} event trace`}
    >
      <style>{TRACE_STYLES}</style>
      <div className="world-trace-head">
        <strong>Event trace</strong>
        <span>
          {now.mode} · {now.pointers} down
        </span>
        <button type="button" onClick={() => void copy()}>
          Copy trace
        </button>
        <button type="button" onClick={() => trace.clear()}>
          Clear
        </button>
        <button
          type="button"
          aria-label="Close the event trace"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {copied && copied !== "Copied" ? (
        <textarea
          readOnly
          className="world-trace-copy"
          value={copied}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      <ol>
        {entries.map((entry, i) => (
          <li key={`${entry.t}-${i}`}>
            <span className="world-trace-t">{entry.t}</span>
            <span className="world-trace-kind">{entry.kind}</span>
            <span className="world-trace-detail">{describe(entry)}</span>
          </li>
        ))}
      </ol>
      {copied === "Copied" ? (
        <p className="world-trace-note">Copied to the clipboard.</p>
      ) : null}
    </div>
  );
}

function describe(entry: TraceEntry) {
  const detail = entry.detail;
  if (detail === undefined) return "";
  if (typeof detail === "string") return detail;
  const text = JSON.stringify(detail);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}
