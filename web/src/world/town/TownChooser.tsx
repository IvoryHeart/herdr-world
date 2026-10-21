import { useEffect, useRef } from "react";

export type TownChooserEntry = {
  key: string;
  label: string;
  detail: string;
  onChoose(): void;
};

/**
 * Every pane of a desk with more panes than drawn seats. Focus moves to the
 * first pane when it opens, Escape closes it, and focus returns to whatever
 * opened it, such as the desk's keyboard target.
 */
export function TownChooser({
  title,
  detail,
  entries,
  onClose,
}: {
  title: string;
  detail: string;
  entries: readonly TownChooserEntry[];
  onClose(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    list.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="town-peek town-peek-sheet town-chooser"
      role="dialog"
      aria-label={`Panes at ${title}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="town-peek-head">
        <div>
          <b>{title}</b>
          <small>{detail}</small>
        </div>
        <button
          type="button"
          className="town-peek-close"
          aria-label="Close panes"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="town-chooser-list" ref={list}>
        {entries.map((entry) => (
          <button key={entry.key} type="button" onClick={entry.onChoose}>
            <span>{entry.label}</span>
            <small>{entry.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
