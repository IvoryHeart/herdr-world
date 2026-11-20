import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../../components/CloseButton";
import { focusDialogElement } from "../../components/dialogFocus";
import { helpFor } from "../../help/entries";
import { HelpEntryCard } from "../../help/HelpEntryCard";
import { openHelp, tryHelp } from "../../help/helpEvents";
import "../../help/helpPanel.css";
import { useLayer } from "../../layerStack";
import { useLayoutPreferences } from "../../layoutPreferences";
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
  const { mobile } = useLayoutPreferences();
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
            <ul className="help-panel-entries help-entries-compact">
              {helpFor("board").map((entry) => (
                <HelpEntryCard
                  key={entry.id}
                  entry={entry}
                  mobile={mobile}
                  onTry={(chosen) => {
                    onClose();
                    tryHelp(chosen.id);
                  }}
                />
              ))}
            </ul>
            <button
              type="button"
              className="help-panel-all"
              onClick={() => {
                onClose();
                openHelp("board");
              }}
            >
              Help for every screen ›
            </button>
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
