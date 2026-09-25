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

export type WorldSearchResult = {
  id: string;
  label: string;
  detail: string;
};

export function worldSearchResult(node: WorldObjectNode): WorldSearchResult {
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  const status = leaf
    ? (leaf.stateLabels[leaf.status] ?? leaf.status)
    : node.hostState;
  return {
    id: node.id,
    label: node.label,
    detail: [node.kind, status, leaf?.taskSummary, node.hostLabel]
      .filter(Boolean)
      .join(" · "),
  };
}

export function WorldViewToolbar({
  viewLabel,
  showSearch = true,
  query,
  onQueryChange,
  resultLabel,
  onSubmit,
  searchResults = [],
  onSearchResultSelect,
  children,
}: {
  viewLabel: string;
  showSearch?: boolean;
  query: string;
  onQueryChange(query: string): void;
  resultLabel?: string;
  onSubmit?(): void;
  searchResults?: readonly WorldSearchResult[];
  onSearchResultSelect?(id: string): void;
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
      {query.trim() && searchResults.length > 0 ? (
        <div
          className="world-view-search-results"
          role="listbox"
          aria-label={`${viewLabel} search results`}
        >
          {searchResults.slice(0, 6).map((result, index) => (
            <button
              key={result.id}
              type="button"
              role="option"
              aria-selected={index === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSearchResultSelect?.(result.id)}
            >
              <strong>{result.label}</strong>
              <small>{result.detail}</small>
            </button>
          ))}
        </div>
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

  if (!showSearch && !children) return null;

  return (
    <div className="world-view-toolbar" aria-label={`${viewLabel} controls`}>
      {showSearch && compact ? (
        <button
          type="button"
          className="world-view-search-toggle"
          aria-label={`Search ${viewLabel}`}
          aria-expanded={compactSearchOpen}
          onClick={() => setCompactSearchOpen((open) => !open)}
        >
          <Search size={16} aria-hidden="true" />
        </button>
      ) : showSearch ? (
        search
      ) : null}
      <div className="world-view-toolbar-actions">{children}</div>
      {showSearch && compact && compactSearchOpen
        ? createPortal(search, document.body)
        : null}
    </div>
  );
}
