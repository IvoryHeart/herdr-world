import { useState } from "react";
import type { WorldObject } from "./worldObject";
import { worldSearchMatches } from "./WorldViewToolbar";

export function WorldSearchResults({
  world,
  query,
  onSelect,
}: {
  world: WorldObject;
  query: string;
  onSelect(id: string): void;
}) {
  const [pageState, setPageState] = useState({ query, page: 0 });
  if (!query.trim()) return null;
  const matches = worldSearchMatches(world, query);
  const page = Math.min(
    pageState.query === query ? pageState.page : 0,
    Math.max(0, Math.ceil(matches.length / 32) - 1),
  );
  const shown = matches.slice(page * 32, (page + 1) * 32);
  return (
    <section
      className="world-search-results"
      aria-label="Observed search results"
    >
      <p role="status">
        {matches.length} matching observed items · {shown.length} shown
        {matches.length > shown.length
          ? ` · ${matches.length - shown.length} results omitted`
          : ""}
      </p>
      {matches.length > 32 && (
        <nav aria-label="Search result pages">
          <button
            type="button"
            aria-label="Previous search results"
            disabled={page === 0}
            onClick={() => setPageState({ query, page: page - 1 })}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(matches.length / 32)}
          </span>
          <button
            type="button"
            aria-label="Next search results"
            disabled={(page + 1) * 32 >= matches.length}
            onClick={() => setPageState({ query, page: page + 1 })}
          >
            Next
          </button>
        </nav>
      )}
      {shown.map((node) => (
        <button
          type="button"
          key={node.id}
          data-world-search-result={node.id}
          onClick={() => onSelect(node.id)}
        >
          {node.label} · {node.hostLabel}
          {node.stale ? " · stale" : ""}
        </button>
      ))}
    </section>
  );
}
