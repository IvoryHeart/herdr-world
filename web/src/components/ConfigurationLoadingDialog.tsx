import { useEffect, useRef } from "react";
import { focusDialogElement } from "./dialogFocus";
import { MobileSheetHandle } from "./MobileSheetHandle";
import "./ConfigurationDialog.css";

export function ConfigurationLoadingDialog({
  onClose,
  buttonLabel = "Cancel",
}: {
  onClose: () => void;
  buttonLabel?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const cancelFocus = focusDialogElement(buttonRef.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") onClose();
      else {
        const handle =
          buttonRef.current?.parentElement?.querySelector<HTMLButtonElement>(
            ".mobile-sheet-handle",
          );
        if (
          document.activeElement === buttonRef.current &&
          handle?.getClientRects().length
        )
          handle.focus();
        else buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop configuration-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal configuration-loading-modal mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Loading Configuration"
      >
        <MobileSheetHandle
          label="Dismiss loading configuration"
          onClose={onClose}
        />
        <p role="status">Loading configuration...</p>
        <button ref={buttonRef} type="button" onClick={onClose}>
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
