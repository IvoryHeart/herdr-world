import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../components/CloseButton";
import { useLayer } from "../layerStack";
import "./placeWindow.css";

/**
 * The one window Town's buildings and elements open (#1170): the post
 * office's Needs you, the Library, Apartments, the warehouse's and Shipyard's
 * Work and the observatory's Usage. A centred
 * modal of one size over the dimmed view, with one header (its title, any
 * actions, the close button); content that needs more room scrolls inside
 * it. On a phone it is a sheet from the bottom that keeps a strip of the view
 * above it. It is a layer (layerStack.ts): Escape and Back close the top
 * window first, then whatever is under it.
 */
export function PlaceWindow({
  name,
  label,
  title,
  actions,
  closeLabel = `Close ${label}`,
  className,
  bodyClassName,
  windowRef,
  onClose,
  children,
  ...data
}: {
  /** Which window this is, as `data-place-window`. */
  name: string;
  /** The dialog's accessible name. */
  label: string;
  /** The header's left side; `label` as a heading without it. */
  title?: ReactNode;
  /** Controls between the title and the close button. */
  actions?: ReactNode;
  closeLabel?: string;
  /** Extra classes for the window, such as its content's own. */
  className?: string;
  bodyClassName?: string;
  /** The window's element, for content whose own layers live inside it. */
  windowRef?: RefObject<HTMLDivElement | null>;
  onClose(): void;
  children: ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  const own = useRef<HTMLDivElement>(null);
  const ref = windowRef ?? own;
  useLayer(true, () => onClose(), { element: () => ref.current });
  // Focus starts inside, so Escape and Tab work before anything is clicked;
  // content that focuses its own first control keeps it.
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement))
      ref.current?.focus({ preventScroll: true });
  }, []);
  return createPortal(
    <div className="modal-backdrop place-window-backdrop">
      <div
        ref={ref}
        className={
          className ? `modal place-window ${className}` : "modal place-window"
        }
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-place-window={name}
        {...data}
      >
        <div className="modal-head place-window-head">
          <div className="place-window-title">{title ?? <h2>{label}</h2>}</div>
          {actions ? (
            <div className="place-window-actions">{actions}</div>
          ) : null}
          <CloseButton onClick={onClose} label={closeLabel} />
        </div>
        <div
          className={
            bodyClassName
              ? `place-window-body ${bodyClassName}`
              : "place-window-body"
          }
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
