import { ExternalLink, Settings2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { workBadgeText } from "../../../../shared/worldSources";
import { WORLD_SOURCES_SETTINGS_EVENT } from "../../workspaceResource";
import type { WorldObject } from "../worldObject";
import { useWorldSources } from "../worldSources";
import {
  workCardFacts,
  workLensColumns,
  type WorkLensGroup,
} from "./workLensModel";

/**
 * The Work lens over Board: pull requests from review to merged, and tickets
 * by status. A card's agents jump to their Board cards.
 */
export function WorkLens({
  world,
  onSelectAgent,
  onClose,
}: {
  world: WorldObject;
  onSelectAgent(id: string): void;
  onClose(): void;
}) {
  const snapshot = useWorldSources();
  const [group, setGroup] = useState<WorkLensGroup>("pull_requests");
  const columns = useMemo(
    () => workLensColumns(snapshot, world, group),
    [snapshot, world, group],
  );
  const connected = snapshot.sources.filter(
    (source) => source.state === "connected",
  );
  const problems = snapshot.sources.filter(
    (source) => source.state === "not_connected" || source.state === "error",
  );
  const empty = columns.every((column) => !column.cards.length);
  return (
    <section className="work-lens" aria-label="Work: pull requests and tickets">
      <header className="work-lens-head">
        <div className="work-lens-tabs" role="tablist" aria-label="Work">
          {(
            [
              ["pull_requests", "Pull requests"],
              ["tickets", "Tickets"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={group === id}
              onClick={() => setGroup(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="work-lens-icon"
          aria-label="Sources settings"
          onClick={() =>
            window.dispatchEvent(new Event(WORLD_SOURCES_SETTINGS_EVENT))
          }
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="work-lens-icon"
          aria-label="Close Work"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {problems.length ? (
        <p className="work-lens-note" role="status">
          {problems
            .map((source) => `${source.label}: ${source.detail}`)
            .join(" ")}
        </p>
      ) : null}
      {empty ? (
        <p className="work-lens-note">
          {snapshot.sources.length === 0
            ? "Loading sources…"
            : connected.length
              ? group === "pull_requests"
                ? "No open pull requests for you."
                : "No tickets or assigned issues."
              : "No source is connected yet. Open Sources settings to connect GitHub or Jira."}
        </p>
      ) : null}
      <div className="work-lens-columns">
        {columns.map((column) => (
          <div
            key={column.lane}
            className="work-lens-column"
            data-lane={column.lane}
          >
            <h3>
              {column.label} <span>{column.cards.length}</span>
            </h3>
            <ul>
              {column.cards.map(({ item, agents }) => (
                <li
                  key={item.key}
                  className="work-card"
                  data-source={item.source}
                >
                  <a
                    className="work-card-ref"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.kind === "ticket"
                      ? item.ref
                      : `${item.repo ?? ""} ${workBadgeText(item)}`}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  <p className="work-card-title">{item.title}</p>
                  <p className="work-card-facts">
                    {[...workCardFacts(item), ...item.roles].join(" · ")}
                  </p>
                  {agents.length ? (
                    <div className="work-card-agents">
                      {agents.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => onSelectAgent(agent.id)}
                          aria-label={`Show agent ${agent.label} on Board`}
                        >
                          {agent.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
