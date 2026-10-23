import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSystemBack } from "../systemBack";
import { useEffectCallback } from "../useEffectCallback";
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";
import { MobileSheetHandle } from "./MobileSheetHandle";
import "./WorkspaceInspectorLocationSheet.css";

/** The existing phone dialog/handle pattern, with the desktop location content. */
export function WorkspaceInspectorLocationSheet({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useEffectCallback(onClose);
  useSystemBack(true, close, "popup");
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const cancel = focusDialogElement(dialog.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancel();
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [close]);
  return createPortal(
    <div
      className="modal-backdrop workspace-inspector-location-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Repository status and source"
        tabIndex={-1}
        className="modal mobile-sheet workspace-inspector-location-sheet"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
            ),
          ].filter((control) => control.getClientRects().length > 0);
          const first = controls[0],
            last = controls[controls.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <MobileSheetHandle label="Dismiss repository status" onClose={close} />
        <div className="workspace-inspector-location-sheet-head">
          <h2>Repository status</h2>
          <CloseButton label="Close repository status" onClick={close} />
        </div>
        <div className="workspace-inspector-location-sheet-content">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
