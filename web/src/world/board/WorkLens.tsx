import { ChevronRight, ExternalLink, Settings2, X } from "lucide-react";
import "./boardAppearance.css";
import "./workLens.css";
import { useMemo, useRef, useState } from "react";
import type {
  WorldSourcesSnapshot,
  WorldSourceStatus,
} from "../../../../shared/worldSources";
import { useLayer } from "../../layerStack";
import { workBadgeText } from "../../../../shared/worldSources";
import { openIntegrations } from "../../integrations";
import { leafPinnedBy, useDeskPins } from "../useDeskPins";
import type { WorldObject } from "../worldObject";
import type { BoardDocumentStore } from "./boardDocument";
import { useWorldSources } from "../worldSources";
import { actionablePullRequest } from "../../../../shared/pullRequests";
import { PullRequestCard } from "../PullRequestCard";
import { usePullRequestAttention } from "../pullRequestAttention";
import { ShipyardPipeline } from "../shipyard/ShipyardPipeline";
import {
  workCardFacts,
  workLensColumns,
  type WorkLensCard,
  type WorkLensGroup,
} from "./workLensModel";

const openSourcesSettings = (source?: WorldSourceStatus) =>
  openIntegrations(source ? `source:${source.id}` : "source:github");

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

/** The lens's tabs: its two kanbans, and the release pipeline (#1028). */
export type WorkLensTab = WorkLensGroup | "releases";

/**
 * The Work lens: pull requests from review to merged, tickets by status, and
 * releases as a pipeline from main to the Worlds running them (#1028).
 * Board opens it over its cards and Town from its post office (#887) or harbour; a
 * card's agents jump to their Board cards or open in Town. It is a layer:
 * Escape, Back or a press outside closes it.
 */
export function WorkLens({
  world,
  anchor,
  onSelectAgent,
  onClose,
  store,
  sources,
  className,
  agentAction = (label) => `Show agent ${label} on Board`,
  initialTab = "pull_requests",
  framed = false,
}: {
  /**
   * Inside a window (Town's PlaceWindow, #1170), which owns the layer and
   * the close button.
   */
  framed?: boolean;
  /** The tab it opens on. */
  initialTab?: WorkLensTab;
  world: WorldObject;
  /**
   * The sources to show; the live ones without it. Town passes its post
   * office's, so the post office's testing fixture shows here too.
   */
  sources?: WorldSourcesSnapshot;
  /** Extra classes for the lens, such as Town's palette and placement. */
  className?: string;
  /** A card's agent button's accessible name. */
  agentAction?(label: string): string;
  /** Board's document store, for the desk pins that order a card's agents. */
  store?: BoardDocumentStore;
  /** The control that toggles the lens; pressing it is not outside. */
  anchor?: () => Element | null;
  onSelectAgent(id: string): void;
  onClose(): void;
}) {
  const live = useWorldSources();
  const snapshot = sources ?? live;
  const sectionRef = useRef<HTMLElement | null>(null);
  useLayer(!framed, onClose, {
    element: () => sectionRef.current,
    anchors: () => [anchor?.() ?? null],
  });
  const [tab, setTab] = useState<WorkLensTab>(initialTab);
  const releases = tab === "releases";
  const group: WorkLensGroup = releases ? "pull_requests" : tab;
  // History days the user opened or closed; the newest day starts open.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const deskPins = useDeskPins(store);
  const columns = useMemo(
    () =>
      workLensColumns(
        snapshot,
        world,
        group,
        undefined,
        leafPinnedBy(deskPins, world.spaces),
      ),
    [snapshot, world, group, deskPins],
  );
  const attention = usePullRequestAttention(
    columns.flatMap((column) =>
      column.cards.map((card) => ({ item: card.item, authors: card.agents })),
    ),
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
      className={className ? `work-lens ${className}` : "work-lens"}
      aria-label="Work: pull requests, tickets and releases"
    >
      <header className="work-lens-head">
        <div className="work-lens-tabs" role="tablist" aria-label="Work">
          {(
            [
              ["pull_requests", "Pull requests"],
              ["tickets", "Tickets"],
              ["releases", "Releases"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="work-lens-icon"
          aria-label="Integrations"
          onClick={() => openSourcesSettings()}
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
        {framed ? null : (
          <button
            type="button"
            className="work-lens-icon"
            aria-label="Close Work"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      {releases ? <ShipyardPipeline /> : null}
      {!releases && problems.length ? (
        <p className="work-lens-note" role="status">
          {problems
            .map((source) => `${source.label}: ${source.detail}`)
            .join(" ")}
        </p>
      ) : null}
      {!releases && unset.length ? (
        <p className="work-lens-hint">
          {unset.map((source) => (
            <button
              key={source.id}
              type="button"
              className="work-lens-setup"
              onClick={() => openSourcesSettings(source)}
            >
              Connect {source.label}
            </button>
          ))}
        </p>
      ) : null}
      {!releases && empty ? (
        <p className="work-lens-note">
          {snapshot.sources.length === 0
            ? "Loading sources…"
            : connected.length
              ? group === "pull_requests"
                ? "No open pull requests for you."
                : "No tickets or assigned issues."
              : "No source is connected yet. Open Integrations to connect GitHub or Jira."}
        </p>
      ) : null}
      {releases ? null : (
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
                                agentAction={agentAction}
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
                  {column.cards.map((card) =>
                    actionablePullRequest(card.item) ? (
                      <li key={card.item.key} className="work-card-pr">
                        <PullRequestCard
                          item={card.item}
                          agents={card.agents}
                          attention={attention.get(card.item.key) ?? null}
                          onSelectAgent={onSelectAgent}
                        />
                      </li>
                    ) : (
                      <WorkCard
                        key={card.item.key}
                        card={card}
                        onSelectAgent={onSelectAgent}
                        agentAction={agentAction}
                      />
                    ),
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A card: its link, title, state words (not for history) and agents. */
function WorkCard({
  card: { item, agents },
  compact = false,
  onSelectAgent,
  agentAction,
}: {
  card: WorkLensCard;
  compact?: boolean;
  onSelectAgent(id: string): void;
  agentAction(label: string): string;
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
              aria-label={agentAction(agent.label)}
            >
              {agent.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
