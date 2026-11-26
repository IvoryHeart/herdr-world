import { Search, X } from "lucide-react";
import { openCommandBox } from "../commandBoxKey";
import { useViewSearchTitle } from "./useFoldingSearch";

/**
 * A view's way into World's one search (#1355, worldFinder.ts): a button that
 * opens the search box, as `/`, Ctrl+F and Cmd+K do. While a search chosen
 * from runs in the view, it shows the search and its count; clicking it
 * reopens the box with it, and its × (or Escape) ends it. Other ways in open
 * the box empty.
 */
export function WorldViewToolbar({
  viewLabel,
  query,
  resultLabel,
  onClear,
}: {
  viewLabel: string;
  /** The search the view shows, or "" when none runs. */
  query: string;
  resultLabel?: string;
  /** End the search. */
  onClear(): void;
}) {
  const title = useViewSearchTitle("Find in World");
  return (
    <div className="world-view-toolbar" aria-label={`${viewLabel} controls`}>
      {query ? (
        <div
          className="world-view-toolbar-search"
          role="search"
          aria-label={`${viewLabel} search`}
        >
          <button
            type="button"
            className="world-view-search-query"
            title={title}
            onClick={() => openCommandBox({ resume: true })}
          >
            <Search size={15} aria-hidden="true" />
            <span>{query}</span>
          </button>
          {resultLabel ? (
            <span className="world-view-toolbar-results" aria-live="polite">
              {resultLabel}
            </span>
          ) : null}
          <button
            type="button"
            className="world-view-search-end"
            aria-label="End search"
            title="End search (Esc)"
            onClick={onClear}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="world-view-search-toggle"
          aria-label="Find in World"
          title={title}
          onClick={() => openCommandBox()}
        >
          <Search size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
