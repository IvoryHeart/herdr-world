import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../../components/CloseButton";
import { focusDialogElement } from "../../components/dialogFocus";
import { useLayer } from "../../layerStack";
import type { WorldAgentStatus } from "../worldObject";
import {
  BOARD_STATUS_LABELS,
  defaultBoardStatusColor,
  type BoardAppearance,
} from "./boardAppearance";

export function BoardSettingsDialog({
  mode,
  appearance,
  onChange,
  onClose,
}: {
  mode: "help" | "colors";
  appearance: BoardAppearance;
  onChange(next: BoardAppearance): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const title = mode === "help" ? "Board help" : "Board status colours";
  useLayer(true, onClose, { element: () => ref.current });
  useEffect(() => focusDialogElement(ref.current), []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={ref}
        className="modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <CloseButton label={`Close ${title}`} onClick={onClose} />
        </div>
        {mode === "help" ? (
          <>
            <p>
              Use Next to open the next agent who needs you. Shared questions
              count too.
            </p>
            <p>
              Drag the empty board to pan. Pinch or use the zoom buttons to
              zoom, and Fit to see everything.
            </p>
            <p>
              Drag a card to arrange it. Drag a pane row onto another tab to
              move only that pane; moves stay on one host.
            </p>
            <p>
              Double-click empty board for a note. Drag a note's handle to an
              agent to connect it, then use Send when ready.
            </p>
            <p>
              On a phone, hold a card or pane row to lift it; a quick swipe
              pans. Cancel a drag without moving the pane.
            </p>
            <p>
              Choose a Surface in the Board menu. Status colours are separate
              from the colours you give cards.
            </p>
          </>
        ) : (
          <>
            <p>
              Change the status dots, rings and badges in this browser. Card
              colours stay as you chose them.
            </p>
            {(
              Object.entries(BOARD_STATUS_LABELS) as [
                WorldAgentStatus,
                string,
              ][]
            ).map(([status, label]) => (
              <label key={status} className="form-field">
                <span>{label}</span>
                <input
                  type="color"
                  aria-label={`${label} status colour`}
                  value={
                    appearance.statusColors[status] ??
                    defaultBoardStatusColor(
                      status,
                      appearance,
                      document.documentElement.dataset.theme,
                    )
                  }
                  onChange={(event) =>
                    onChange({
                      ...appearance,
                      statusColors: {
                        ...appearance.statusColors,
                        [status]: event.currentTarget.value,
                      },
                    })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => onChange({ ...appearance, statusColors: {} })}
            >
              Reset status colours
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
