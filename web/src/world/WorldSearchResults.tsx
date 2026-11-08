import { useEffect, useRef, useState } from "react";
import { AgentMark } from "../components/AgentMark";
import { agentMarkKind } from "./agentMarks";
import type { WorldObject } from "./worldObject";
import {
  worldSearchResults,
  type WorldSearchKind,
  type WorldSearchResult,
} from "./worldSearch";

const PAGE = 32;

const KIND_WORDS: Record<WorldSearchKind, string> = {
  building: "Building",
  room: "Room",
  table: "Table",
  agent: "Agent",
  terminal: "Terminal",
};

/** One result: what it is, its name and status, where it is, and why. */
function WorldSearchRow({
  result,
  active,
  onChoose,
}: {
  result: WorldSearchResult;
  active: boolean;
  onChoose(result: WorldSearchResult): void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      className="world-search-result"
      data-world-search-result={result.id}
      data-kind={result.kind}
      aria-current={active ? "true" : undefined}
      onClick={() => onChoose(result)}
    >
      <span className="world-search-result-head">
        <span className="world-search-result-kind">
          {KIND_WORDS[result.kind]}
        </span>
        {result.status ? (
          <AgentMark
            kind={agentMarkKind(result.status, { offline: result.stale })}
          />
        ) : null}
        <span className="world-search-result-name">{result.label}</span>
        {result.stale ? (
          <span className="world-search-result-stale">stale</span>
        ) : null}
      </span>
      {result.place.length ? (
        <span className="world-search-result-place">
          {result.place.join(" › ")}
        </span>
      ) : null}
      {result.excerpt ? (
        <span className="world-search-result-excerpt">
          {result.excerpt.map((part, index) =>
            part.match ? (
              <mark key={index}>{part.text}</mark>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The search's results, a page at a time. Without `results` it searches
 * `world` itself and choosing a result selects it (Board); Town passes its
 * results, the row Up and Down are on, and what choosing does.
 */
export function WorldSearchResults({
  world,
  query,
  onSelect,
  results: given,
  activeId = null,
  onActivate,
  onChoose,
  offscreen,
}: {
  world: WorldObject;
  query: string;
  onSelect(id: string): void;
  results?: readonly WorldSearchResult[];
  /** The row Up and Down are on; its page is shown. */
  activeId?: string | null;
  /** Paging moves the active row to the page's first. */
  onActivate?(id: string): void;
  onChoose?(result: WorldSearchResult): void;
  /** Matches outside the visible map, for a map view. */
  offscreen?: number;
}) {
  const [pageState, setPageState] = useState({ query, page: 0 });
  if (!query.trim()) return null;
  const matches = given ?? worldSearchResults(world, query);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE));
  const activeIndex = activeId
    ? matches.findIndex((result) => result.id === activeId)
    : -1;
  const page = Math.min(
    activeIndex >= 0
      ? Math.floor(activeIndex / PAGE)
      : pageState.query === query
        ? pageState.page
        : 0,
    pages - 1,
  );
  const shown = matches.slice(page * PAGE, (page + 1) * PAGE);
  const turn = (next: number) => {
    setPageState({ query, page: next });
    const first = matches[next * PAGE];
    if (first) onActivate?.(first.id);
  };
  const choose = onChoose ?? ((result) => onSelect(result.nodeId));
  return (
    <section
      className="world-search-results"
      aria-label="Observed search results"
    >
      <p role="status">
        {matches.length === 1 ? "1 match" : `${matches.length} matches`}
        {offscreen ? ` · ${offscreen} off-screen` : ""}
        {matches.length > shown.length ? ` · ${shown.length} shown` : ""}
      </p>
      {matches.length > PAGE && (
        <nav aria-label="Search result pages">
          <button
            type="button"
            aria-label="Previous search results"
            disabled={page === 0}
            onClick={() => turn(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            aria-label="Next search results"
            disabled={page + 1 >= pages}
            onClick={() => turn(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
      {shown.map((result) => (
        <WorldSearchRow
          key={result.id}
          result={result}
          active={result.id === activeId}
          onChoose={choose}
        />
      ))}
    </section>
  );
}
