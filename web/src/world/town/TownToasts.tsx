/**
 * Town's toasts: short notes at the top of the town, at most three at once.
 * A note may offer one action (Tidy rooms' Undo), and then stays a little
 * longer, as Board's Undo does.
 */

import { useCallback, useRef, useState } from "react";
import { DEVTOOLS, type ViewTrace } from "../devtools/flag";
import "./townToasts.css";

export type TownToastAction = { label: string; run(): void };
export type TownToast = (
  kind: "ok" | "error",
  text: string,
  action?: TownToastAction,
) => void;

type Note = {
  id: number;
  kind: "ok" | "error";
  text: string;
  action?: TownToastAction;
};

export function useTownToasts(trace: ViewTrace) {
  const [notes, setNotes] = useState<Note[]>([]);
  const lastId = useRef(0);
  const dismiss = useCallback(
    (id: number) => setNotes((current) => current.filter((n) => n.id !== id)),
    [],
  );
  const toast = useCallback<TownToast>(
    (kind, text, action) => {
      if (DEVTOOLS) trace.record("toast", { kind, text });
      const id = ++lastId.current;
      setNotes((current) => [...current.slice(-2), { id, kind, text, action }]);
      window.setTimeout(
        () => dismiss(id),
        action ? 5_000 : kind === "error" ? 6_000 : 2_600,
      );
    },
    [trace, dismiss],
  );
  const view = (
    <div className="town-toasts" role="status" aria-live="polite">
      {notes.map((item) => (
        <div key={item.id} className={`town-toast town-toast-${item.kind}`}>
          <i aria-hidden="true">{item.kind === "ok" ? "✓" : "!"}</i>
          {item.text}
          {item.action ? (
            <button
              type="button"
              className="town-toast-action"
              onClick={() => {
                dismiss(item.id);
                item.action!.run();
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
  return { toast, view };
}
