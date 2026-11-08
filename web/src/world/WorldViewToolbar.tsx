import { Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export {
  worldNodeSearchText,
  worldSearchMatches,
} from "./worldSearch";

export function WorldViewToolbar({
  viewLabel,
  query,
  onQueryChange,
  resultLabel,
  onSubmit,
  onNavigate,
  onClear,
  children,
}: {
  viewLabel: string;
  query: string;
  onQueryChange(query: string): void;
  resultLabel?: string;
  /** Enter. Returning false keeps the phone's search open. */
  onSubmit?(): void | boolean;
  /** Up and Down step through the results. */
  onNavigate?(step: 1 | -1): void;
  /**
   * Escape and the phone's close button empty the search, rather than
   * leaving the phone's search with its query.
   */
  onClear?(): void;
  children?: ReactNode;
}) {
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  const [compactSearchOpen, setCompactSearchOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => {
      setCompact(media.matches);
      if (!media.matches) setCompactSearchOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const done = onSubmit?.();
    if (onSubmit && done !== false && compact) setCompactSearchOpen(false);
  };
  const close = () => {
    onClear?.();
    setCompactSearchOpen(false);
  };
  const search = (
    <form
      className={
        compact ? "world-view-search-overlay" : "world-view-toolbar-search"
      }
      role="search"
      onSubmit={submit}
    >
      <Search size={15} aria-hidden="true" />
      <label>
        <span className="world-sr-only">Search {viewLabel}</span>
        <input
          autoFocus={compact}
          type="search"
          value={query}
          placeholder={`Search ${viewLabel}`}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              onNavigate &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              onNavigate(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Escape" && (compact || onClear)) {
              event.preventDefault();
              if (compact) close();
              else onClear?.();
            }
          }}
        />
      </label>
      {resultLabel ? (
        <span className="world-view-toolbar-results" aria-live="polite">
          {resultLabel}
        </span>
      ) : null}
      {compact ? (
        <button
          type="button"
          aria-label={`Close ${viewLabel} search`}
          title="Close search"
          onClick={close}
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </form>
  );

  return (
    <div className="world-view-toolbar" aria-label={`${viewLabel} controls`}>
      {compact ? (
        <button
          type="button"
          className="world-view-search-toggle"
          aria-label={`Search ${viewLabel}`}
          aria-expanded={compactSearchOpen}
          onClick={() => setCompactSearchOpen((open) => !open)}
        >
          <Search size={16} aria-hidden="true" />
        </button>
      ) : (
        search
      )}
      {children ? (
        <div className="world-view-toolbar-actions">{children}</div>
      ) : null}
      {compact && compactSearchOpen
        ? createPortal(search, document.body)
        : null}
    </div>
  );
}
