import { useMemo, useState } from "react";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";

const PAGE_SIZE = 50;

/** Bounded controls over the complete roster; native options never grow with the scene. */
export function OfficeNavigator({
  office,
  onRoom,
  onAgent,
  onReceptions,
}: {
  office: HerdrOfficeProjection;
  onRoom(key: string): void;
  onAgent(key: string): void;
  onReceptions(): void;
}) {
  const [kind, setKind] = useState<"rooms" | "agents" | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const entries = useMemo(() => {
    if (!kind) return [];
    const candidates =
      kind === "rooms"
        ? office.roomRoster.map((room) => ({
            key: room.key,
            label: `${room.hostLabel} / ${room.displayLabel}`,
          }))
        : office.roster.map(({ agent, hostLabel }) => ({
            key: agent.key,
            label: `${hostLabel} / ${agent.displayLabel} · ${agent.semanticStatus}`,
          }));
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? candidates.filter((entry) =>
          entry.label.toLocaleLowerCase().includes(needle),
        )
      : candidates;
  }, [office, kind, query]);
  const lastPage = Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const toggle = (next: "rooms" | "agents") => {
    setKind(kind === next ? null : next);
    setQuery("");
    setPage(0);
  };
  return (
    <div className="world-office-navigation">
      <button
        type="button"
        aria-expanded={kind === "rooms"}
        onClick={() => toggle("rooms")}
      >
        Rooms
      </button>
      <button type="button" onClick={onReceptions}>
        Receptions
      </button>
      <button
        type="button"
        aria-expanded={kind === "agents"}
        onClick={() => toggle("agents")}
      >
        Agents · {office.coverage.status.blocked} waiting ·{" "}
        {office.coverage.status.idle} idle
      </button>
      {kind ? (
        <section
          className="world-office-navigator-panel"
          aria-label={`Office ${kind}`}
        >
          <div className="world-office-navigator-search">
            <input
              autoFocus
              aria-label={`Find Office ${kind}`}
              placeholder={`Find ${kind}…`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setKind(null);
              }}
            />
            <button
              type="button"
              onClick={() => setKind(null)}
              aria-label="Close Office navigator"
            >
              ×
            </button>
          </div>
          <div className="world-office-navigator-list">
            {entries
              .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
              .map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  onClick={() => {
                    if (kind === "rooms") onRoom(entry.key);
                    else onAgent(entry.key);
                    setKind(null);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            {entries.length === 0 ? <p>No matches.</p> : null}
          </div>
          <div className="world-office-navigator-pages">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>
              {entries.length} {kind}
            </span>
            <button
              type="button"
              disabled={currentPage >= lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
