import { Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { playFocusEnd } from "../chimes/chimeCenter";
import { focusChoiceLabel } from "../../../shared/focus";
import { CloseButton } from "../components/CloseButton";
import { useLayer } from "../layerStack";
import { useNow } from "./handoffs";
import {
  FOCUS_RECAP_EVENT,
  WORLD_FOCUS_EVENT,
  claimFocusChime,
  endFocus,
  focusChimed,
  focusChoices,
  focusHeld,
  focusLeftText,
  focusNow,
  shouldChimeFocusEnd,
  startFocus,
  useFocus,
} from "./focus";
import "./focus.css";

/** Keeps the time left current: every 15 s, and at the session's end. */
export function useFocusClock() {
  const focus = useFocus();
  useNow(15_000);
  const now = focusNow();
  return {
    state: focus.state,
    error: focus.error,
    held: focusHeld(focus.state, now),
    left: focusLeftText(focus.state, now),
  };
}

/**
 * The focus controls (#1131): the lengths to start one, or, while focused,
 * the time left and End now. The Town board and the Focus dialog show them.
 */
export function FocusControls({ onDone }: { onDone?: () => void }) {
  const { held, left, error } = useFocusClock();
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void action()
      .then(() => onDone?.())
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <div className="focus-controls" data-focused={held}>
      {held ? (
        <div className="focus-controls-row">
          <span className="focus-controls-status">
            <Headphones size={13} aria-hidden="true" />
            Focused · {left}
          </span>
          <button
            type="button"
            className="focus-end"
            disabled={busy}
            onClick={() => run(endFocus)}
          >
            End now
          </button>
        </div>
      ) : (
        <div className="focus-controls-row" role="group" aria-label="Focus for">
          {focusChoices().map((minutes) => (
            <button
              key={minutes ?? "open"}
              type="button"
              className="focus-choice"
              disabled={busy}
              aria-label={`Focus ${focusChoiceLabel(minutes).toLowerCase()}`}
              onClick={() => run(() => startFocus(minutes))}
            >
              {focusChoiceLabel(minutes)}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <p className="focus-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Focus dialog, from the town center's ring, the Menu and the command
 * box: one tap starts a session or ends the running one.
 */
export function FocusDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, onClose, { element: () => ref.current });
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal focus-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Focus"
      >
        <div className="modal-head">
          <h2>Focus</h2>
          <CloseButton onClick={onClose} label="Close focus" />
        </div>
        <p className="focus-dialog-note">
          Chimes, notifications and the count on the tab hold on every device.
          Town and Needs you keep showing everything; when it ends you get one
          chime and a recap.
        </p>
        <FocusControls onDone={onClose} />
      </div>
    </div>
  );
}

/**
 * A session's end on this device: one chime (only when it reached its time,
 * once per device, near its end) and the Town board opened on its recap.
 */
export function useFocusEnd() {
  const { state } = useFocus();
  const last = state?.last ?? null;
  useEffect(() => {
    if (!last || !shouldChimeFocusEnd(last, focusNow(), focusChimed())) return;
    if (!claimFocusChime(last.id)) return;
    playFocusEnd();
    window.dispatchEvent(new Event(FOCUS_RECAP_EVENT));
    // Only a new ended session counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);
}

/** The Focus dialog, opened by `openFocus()` from any view. */
export function FocusDialogHost() {
  const [open, setOpen] = useState(false);
  useFocusEnd();
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(WORLD_FOCUS_EVENT, show);
    return () => window.removeEventListener(WORLD_FOCUS_EVENT, show);
  }, []);
  return open ? <FocusDialog onClose={() => setOpen(false)} /> : null;
}
