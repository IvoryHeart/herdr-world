import { Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WorldObject, WorldObjectNode } from "./worldObject";

export function worldNodeSearchText(node: WorldObjectNode) {
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  return [
    node.label,
    node.hostLabel,
    node.connectionId,
    node.kind,
    leaf?.spaceLabel,
    leaf?.tabLabel,
    leaf?.status,
    leaf?.agentLabel,
    leaf?.modelLabel,
    leaf?.taskSummary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function worldSearchMatches(world: WorldObject, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [];
  return world.nodes.filter((node) =>
    worldNodeSearchText(node).includes(query),
  );
}

export function WorldViewToolbar({
  viewLabel,
  query,
  onQueryChange,
  resultLabel,
  onSubmit,
  children,
}: {
  viewLabel: string;
  query: string;
  onQueryChange(query: string): void;
  resultLabel?: string;
  onSubmit?(): void;
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
    onSubmit?.();
    if (onSubmit && compact) setCompactSearchOpen(false);
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
            if (event.key === "Escape" && compact) {
              event.preventDefault();
              setCompactSearchOpen(false);
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
          onClick={() => setCompactSearchOpen(false)}
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
      <div className="world-view-toolbar-actions">{children}</div>
      {compact && compactSearchOpen
        ? createPortal(search, document.body)
        : null}
    </div>
  );
}
