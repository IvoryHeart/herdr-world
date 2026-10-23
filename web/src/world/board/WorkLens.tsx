import { ChevronRight, ExternalLink, Settings2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { WorldSourceStatus } from "../../../../shared/worldSources";
import { useLayer } from "../../layerStack";
import { workBadgeText } from "../../../../shared/worldSources";
import { WORLD_SOURCES_SETTINGS_EVENT } from "../../workspaceResource";
import type { WorldObject } from "../worldObject";
import { useWorldSources } from "../worldSources";
import {
  workCardFacts,
  workLensColumns,
  type WorkLensCard,
  type WorkLensGroup,
} from "./workLensModel";

const openSourcesSettings = () =>
  window.dispatchEvent(new Event(WORLD_SOURCES_SETTINGS_EVENT));

/**
 * A source the user never set up is a quiet hint, not a problem: it has never
 * answered, and (for Jira) has nothing saved.
 */
function neverSetUp(source: WorldSourceStatus) {
  if (source.state !== "not_connected" || source.lastSuccessAt !== null)
    return false;
  return source.config.kind !== "jira"
    ? true
    : !source.config.site && !source.config.email && !source.config.tokenSet;
}

/**
 * The Work lens over Board: pull requests from review to merged, and tickets
 * by status. A card's agents jump to their Board cards. It is a layer:
 * Escape, Back or a press outside closes it.
 */
export function WorkLens({
  world,
  anchor,
  onSelectAgent,
  onClose,
}: {
  world: WorldObject;
  /** The control that toggles the lens; pressing it is not outside. */
  anchor?: () => Element | null;
  onSelectAgent(id: string): void;
  onClose(): void;
}) {
  const snapshot = useWorldSources();
  const sectionRef = useRef<HTMLElement | null>(null);
  useLayer(true, onClose, {
    element: () => sectionRef.current,
    anchors: () => [anchor?.() ?? null],
  });
  const [group, setGroup] = useState<WorkLensGroup>("pull_requests");
  // History days the user opened or closed; the newest day starts open.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const columns = useMemo(
    () => workLensColumns(snapshot, world, group),
    [snapshot, world, group],
  );
  const connected = snapshot.sources.filter(
    (source) => source.state === "connected",
  );
  const problems = snapshot.sources.filter(
    (source) =>
      source.state === "error" ||
      (source.state === "not_connected" && !neverSetUp(source)),
  );
  const unset = snapshot.sources.filter(neverSetUp);
  const empty = columns.every((column) => !column.cards.length);
  return (
    <section
      ref={sectionRef}
      className="work-lens"
      aria-label="Work: pull requests and tickets"
    >
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
          onClick={openSourcesSettings}
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
      {unset.length ? (
        <p className="work-lens-hint">
          {unset.map((source) => (
            <button
              key={source.id}
              type="button"
              className="work-lens-setup"
              onClick={openSourcesSettings}
            >
              Set up {source.label}
            </button>
          ))}
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
            {column.days ? (
              <div className="work-lens-days">
                {column.days.map((day, index) => {
                  const key = `${column.lane}:${day.key}`;
                  const open = openDays[key] ?? index === 0;
                  return (
                    <section key={day.key} aria-label={day.label}>
                      <button
                        type="button"
                        className="work-lens-day"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenDays((value) => ({ ...value, [key]: !open }))
                        }
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                        {day.label} <span>{day.cards.length}</span>
                      </button>
                      {open ? (
                        <ul>
                          {day.cards.map((card) => (
                            <WorkCard
                              key={card.item.key}
                              card={card}
                              compact
                              onSelectAgent={onSelectAgent}
                            />
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : (
              <ul>
                {column.cards.map((card) => (
                  <WorkCard
                    key={card.item.key}
                    card={card}
                    onSelectAgent={onSelectAgent}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A card: its link, title, state words (not for history) and agents. */
function WorkCard({
  card: { item, agents },
  compact = false,
  onSelectAgent,
}: {
  card: WorkLensCard;
  compact?: boolean;
  onSelectAgent(id: string): void;
}) {
  return (
    <li className="work-card" data-source={item.source}>
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
      {compact ? null : (
        <p className="work-card-facts">
          {[...workCardFacts(item), ...item.roles].join(" · ")}
        </p>
      )}
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
  );
}
