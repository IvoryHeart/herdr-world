import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  formatOfficeCost,
  formatOfficeModelName,
  type OfficeObservability,
} from "../officeObservability";
import { WorldPanel } from "../windows/WorldPanel";
import type { WorldObject } from "../worldObject";
import { TownAsk, type TownCall } from "./TownRail";
import { sharedAsksStore, useWorldAsks } from "../worldAsks";
import {
  townSummary,
  townSummaryAge,
  type TownSummary as TownSummaryModel,
  type TownSummaryCounts,
  type TownSummaryItem,
} from "./townSummary";
import "./townSummaryPanel.css";

/**
 * The Town summary's body, in attention order: who needs you, recent
 * finishes, hosts and their rooms, and spend. It renders the shared read
 * model (townSummary.ts); the window around it is the shared panel frame.
 */
export function TownSummaryPanel({
  summary,
  now,
  onOpenAgent,
  onShowRoom,
  onAnswer,
}: {
  summary: TownSummaryModel;
  now: number;
  /** Open the agent's conversation, as reception does. */
  onOpenAgent(agentKey: string): void;
  /** Move the Town camera to a room. */
  onShowRoom(roomKey: string): void;
  onAnswer(id: string, text: string): Promise<string | null>;
}) {
  return (
    <div className="town-summary">
      <section aria-labelledby="town-summary-needs">
        <h3 id="town-summary-needs">
          Needs you <span>{summary.counts.needsYou}</span>
        </h3>
        {summary.asks.length > 0 ? (
          <div className="town-asks">
            {summary.asks.map((ask) => (
              <TownAsk key={ask.id} ask={ask} now={now} onAnswer={onAnswer} />
            ))}
          </div>
        ) : null}
        {summary.needsYou.length ? (
          <ul>
            {summary.needsYou.map((item) => (
              <SummaryItem
                key={item.agent.key}
                item={item}
                detail={
                  townSummaryAge(item.since, now) === "just now"
                    ? "waiting under a minute"
                    : `waiting ${townSummaryAge(item.since, now).replace(" ago", "")}`
                }
                action="Answer"
                onOpen={onOpenAgent}
              />
            ))}
          </ul>
        ) : summary.asks.length ? null : (
          <p className="town-summary-empty">Nobody is waiting for you.</p>
        )}
      </section>
      <section aria-labelledby="town-summary-finished">
        <h3 id="town-summary-finished">
          Finished, not reviewed <span>{summary.counts.finished}</span>
        </h3>
        {summary.finished.length ? (
          <ul>
            {summary.finished.map((item) => (
              <SummaryItem
                key={item.agent.key}
                item={item}
                // Herdr reports the session's last activity, not the moment
                // it finished, so the age says so.
                detail={
                  item.since === null
                    ? "finished"
                    : `last active ${townSummaryAge(item.since, now)}`
                }
                action="Open"
                onOpen={onOpenAgent}
              />
            ))}
          </ul>
        ) : (
          <p className="town-summary-empty">Nothing new has finished.</p>
        )}
      </section>
      <section aria-labelledby="town-summary-hosts">
        <h3 id="town-summary-hosts">Hosts and rooms</h3>
        <div className="town-summary-hosts">
          {summary.hosts.map((host) => (
            <div key={host.key} className="town-summary-host">
              <div className="town-summary-host-name">
                <strong>{host.label}</strong>
                {host.stale ? <small>Offline · stale</small> : null}
                <Counts counts={host.counts} />
              </div>
              {host.rooms.map((room) => (
                <button
                  key={room.key}
                  type="button"
                  className="town-summary-room"
                  aria-label={`Show room ${room.label} in Town`}
                  onClick={() => onShowRoom(room.key)}
                >
                  <span>{room.label}</span>
                  <Counts counts={room.counts} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="town-summary-spend">
        <h3 id="town-summary-spend">Spend</h3>
        {summary.spend.available ? (
          <>
            <p className="town-summary-spend-total">
              {formatOfficeCost(summary.spend.totalUsd)}
            </p>
            <ul className="town-summary-models">
              {summary.spend.models.map((model) => (
                <li key={model.model}>
                  <span>{formatOfficeModelName(model.model)}</span>
                  <b>{formatOfficeCost(model.costUsd)}</b>
                </li>
              ))}
            </ul>
            <p className="town-summary-provenance">
              from {summary.spend.providerId ?? "metrics"} ·{" "}
              {townSummaryAge(summary.spend.observedAt, now)}
            </p>
          </>
        ) : (
          <p className="town-summary-empty">
            No cost data. Configure a metrics provider in settings.
          </p>
        )}
      </section>
    </div>
  );
}

function SummaryItem({
  item,
  detail,
  action,
  onOpen,
}: {
  item: TownSummaryItem;
  detail: string;
  action: string;
  onOpen(agentKey: string): void;
}) {
  return (
    <li className="town-summary-item">
      <div>
        <strong>
          {item.agent.displayLabel}
          {item.agent.semanticStatus === "blocked"
            ? " · blocked: needs input"
            : ""}
        </strong>
        <small>
          {item.roomLabel} · {item.hostLabel} · {detail}
        </small>
      </div>
      <button
        type="button"
        aria-label={`${action} ${item.agent.displayLabel}`}
        onClick={() => onOpen(item.agent.key)}
      >
        {action}
      </button>
    </li>
  );
}

const COUNT_LABELS: [keyof TownSummaryCounts, string][] = [
  ["needsYou", "need you"],
  ["working", "working"],
  ["finished", "finished"],
  ["quiet", "quiet"],
  ["unknown", "unknown"],
];

function Counts({ counts }: { counts: TownSummaryCounts }) {
  const shown = COUNT_LABELS.filter(([key]) => counts[key] > 0);
  return (
    <span className="town-summary-counts">
      {shown.length
        ? shown.map(([key, label]) => (
            <span key={key} data-count={key}>
              {counts[key]} {label}
            </span>
          ))
        : "empty"}
    </span>
  );
}

/**
 * Town's summary: the shared read model for the board sign and phone chip,
 * and its window while open. A room chosen in the window becomes `roomFocus`
 * for the canvas; on a phone the window closes first, since it covers Town.
 */
export function useTownSummary({
  world,
  office,
  calls,
  observability,
  now,
  openAgent,
}: {
  world: WorldObject;
  office: HerdrOfficeProjection;
  calls: readonly TownCall[];
  observability: OfficeObservability;
  now: number;
  openAgent(agentKey: string): void;
}): {
  summary: TownSummaryModel;
  viewportWidth: number;
  answerAsk(id: string, text: string): Promise<string | null>;
  open(): void;
  roomFocus: { roomKey: string; seq: number } | null;
  window: ReactNode;
} {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const asksStore = sharedAsksStore();
  const asks = useWorldAsks(asksStore);
  const answerAsk = (id: string, text: string) => asksStore.answer(id, text);
  const summary = useMemo(
    () =>
      townSummary(
        office,
        calls,
        observability,
        (agent) => {
          const leaf = world.nodeById.get(agent.nodeId);
          return leaf && "lastActivityAt" in leaf
            ? leaf.lastActivityAt
            : undefined;
        },
        asks,
      ),
    [world, office, calls, observability, asks],
  );
  const [isOpen, setOpen] = useState(false);
  const [roomFocus, setRoomFocus] = useState<{
    roomKey: string;
    seq: number;
  } | null>(null);
  return {
    summary,
    viewportWidth,
    answerAsk,
    open: () => setOpen(true),
    roomFocus,
    window: isOpen ? (
      <WorldPanel
        name="town-summary"
        label="Town summary"
        onClose={() => setOpen(false)}
      >
        <TownSummaryPanel
          summary={summary}
          now={now}
          onOpenAgent={openAgent}
          onAnswer={answerAsk}
          onShowRoom={(roomKey) => {
            if (viewportWidth <= 640) setOpen(false);
            setRoomFocus((last) => ({ roomKey, seq: (last?.seq ?? 0) + 1 }));
          }}
        />
      </WorldPanel>
    ) : null,
  };
}
