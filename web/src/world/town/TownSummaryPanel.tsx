import { answerRecipientView } from "./answerOutbox";
import { ConnectedAnswerDeliveries } from "./AnswerDeliveries";
import { useAnswerDeliveryCounts } from "../worldAnswerDeliveries";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  formatOfficeCost,
  formatOfficeModelName,
  type OfficeObservability,
} from "../officeObservability";
import { WorldPanel } from "../windows/WorldPanel";
import type { WorldObject } from "../worldObject";
import { GroupsSummary } from "../groups/GroupsSummary";
import {
  TownAsk,
  townLocation,
  type TownAskActions,
  type TownCall,
} from "./TownRail";
import { townAskers } from "./townAskers";
import { sharedAsksStore, useWorldAsks } from "../worldAsks";
import {
  townSummary,
  townSummaryAge,
  type TownPlaceSummary,
  type TownSummary as TownSummaryModel,
  type TownSummaryCounts,
  type TownSummaryItem,
} from "./townSummary";
import "./townSummaryPanel.css";

/**
 * The Town summary's body, in attention order: who needs you, recent
 * finishes, hosts and their rooms, Pods, and spend. It renders the shared read
 * model (townSummary.ts); the window around it is the shared panel frame.
 */
export function TownSummaryPanel({
  summary,
  now,
  onOpenAgent,
  onShowRoom,
  askActions,
  groups,
  deliveries,
}: {
  summary: TownSummaryModel;
  now: number;
  /** Open the agent's conversation, as reception does. */
  onOpenAgent(agentKey: string): void;
  /** Move the Town camera to a room. */
  onShowRoom(roomKey: string): void;
  askActions: TownAskActions;
  groups?: ReactNode;
  deliveries?: ReactNode;
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
              <TownAsk key={ask.id} ask={ask} now={now} actions={askActions} />
            ))}
          </div>
        ) : null}
        {summary.needsYou.length ? (
          <ul>
            {summary.needsYou.map((item) => (
              <SummaryItem
                key={item.agent.key}
                item={item}
                detail={waitingDetail(item, now)}
                action="Answer"
                onOpen={onOpenAgent}
              />
            ))}
          </ul>
        ) : summary.asks.length ? null : (
          <p className="town-summary-empty">Nobody is waiting for you.</p>
        )}
      </section>
      {deliveries}
      <section aria-labelledby="town-summary-finished">
        <h3 id="town-summary-finished">
          Done, not reviewed <span>{summary.counts.finished}</span>
        </h3>
        {summary.finished.length ? (
          <ul>
            {summary.finished.map((item) => (
              <SummaryItem
                key={item.agent.key}
                item={item}
                detail={finishedDetail(item, now)}
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
      {groups}
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

function waitingDetail(item: TownSummaryItem, now: number) {
  const age = townSummaryAge(item.since, now);
  return age === "just now"
    ? "waiting under a minute"
    : `waiting ${age.replace(" ago", "")}`;
}

/**
 * Herdr reports the session's last activity, not the moment it finished, so
 * the age says so.
 */
function finishedDetail(item: TownSummaryItem, now: number) {
  return item.since === null
    ? "done"
    : `last active ${townSummaryAge(item.since, now)}`;
}

/** Items a room or table card lists before pointing to the full summary. */
const PLACE_ITEMS = 3;

/**
 * A room's or table's part of the Town summary (townPlaceSummary), in the
 * card its name opens: the summary's counts, then who needs you and recent
 * finishes there, with the same Answer and Open actions.
 */
export function TownPlaceSummaryCard({
  place,
  now,
  onOpenAgent,
}: {
  place: TownPlaceSummary;
  now: number;
  onOpenAgent(agentKey: string): void;
}) {
  const needsYou = place.needsYou.slice(0, PLACE_ITEMS);
  const finished = place.finished.slice(
    0,
    Math.max(0, PLACE_ITEMS - needsYou.length),
  );
  const more =
    place.needsYou.length +
    place.finished.length -
    needsYou.length -
    finished.length;
  return (
    <div className="town-place-summary">
      <Counts counts={place.counts} />
      {needsYou.length || finished.length ? (
        <ul>
          {needsYou.map((item) => (
            <SummaryItem
              key={item.agent.key}
              item={item}
              detail={waitingDetail(item, now)}
              action="Answer"
              onOpen={onOpenAgent}
              located={false}
            />
          ))}
          {finished.map((item) => (
            <SummaryItem
              key={item.agent.key}
              item={item}
              detail={finishedDetail(item, now)}
              action="Open"
              onOpen={onOpenAgent}
              located={false}
            />
          ))}
        </ul>
      ) : null}
      {more > 0 ? (
        <small className="town-place-summary-more">
          {more} more in the Town summary
        </small>
      ) : null}
    </div>
  );
}

function SummaryItem({
  item,
  detail,
  action,
  onOpen,
  located = true,
}: {
  item: TownSummaryItem;
  detail: string;
  action: string;
  onOpen(agentKey: string): void;
  /** Whether to name the item's room and host (a place card is there). */
  located?: boolean;
}) {
  return (
    <li className="town-summary-item">
      <div>
        <strong>
          {item.agent.displayLabel}
          {item.agent.semanticStatus === "blocked"
            ? ` · blocked: ${item.agent.stateLabels.blocked?.trim() || "needs you"}`
            : ""}
        </strong>
        <small>{located ? `${townLocation(item)} · ${detail}` : detail}</small>
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
  ["finished", "done"],
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
  openTerminal,
  showRoom,
}: {
  world: WorldObject;
  office: HerdrOfficeProjection;
  calls: readonly TownCall[];
  observability: OfficeObservability;
  now: number;
  openAgent(agentKey: string): void;
  /** Open a terminal by its World node, as a reception question entry does. */
  openTerminal(nodeId: string): void;
  showRoom(roomKey: string): void;
}): {
  summary: TownSummaryModel;
  deliveries: ReactNode;
  deliveryCount: number;
  deliveryWaiting: number;
  openOutbox(): void;
  askActions: TownAskActions;
  openTerminal(nodeId: string): void;
  open(): void;
  window: ReactNode;
} {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const { checks: deliveryCount, waiting: deliveryWaiting } =
    useAnswerDeliveryCounts();
  const [deliveryFocus, setDeliveryFocus] = useState(0);
  const deliveries = (
    <ConnectedAnswerDeliveries
      focusKey={deliveryFocus}
      recipient={(notice) => answerRecipientView(notice.ask, world, office)}
      open={(target) => {
        if (target.key === null) return;
        if (target.terminal) openTerminal(target.key);
        else openAgent(target.key);
      }}
    />
  );
  const asksStore = sharedAsksStore();
  const asks = useWorldAsks(asksStore);
  const askers = useMemo(
    () => townAskers(asks, world, office),
    [asks, world, office],
  );
  const askActions = useMemo<TownAskActions>(
    () => ({
      askers,
      answer: (id, text) => asksStore.answer(id, text),
      dismiss: (id) => asksStore.dismiss(id),
      open: (asker) => {
        if (asker.key === null) return;
        if (asker.terminal) openTerminal(asker.key);
        else openAgent(asker.key);
      },
    }),
    [askers, asksStore, openAgent, openTerminal],
  );
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
  const [focusKey, setFocusKey] = useState(0);
  const openOutbox = useCallback(() => {
    setOpen(true);
    setFocusKey((key) => key + 1);
    setDeliveryFocus((key) => key + 1);
  }, []);
  return {
    summary,
    deliveries,
    deliveryCount,
    deliveryWaiting,
    openOutbox,
    askActions,
    openTerminal,
    open: () => {
      setOpen(true);
      setFocusKey((key) => key + 1);
    },
    window: isOpen ? (
      <WorldPanel
        name="town-summary"
        label="Town summary"
        focusKey={focusKey}
        onClose={() => setOpen(false)}
      >
        <TownSummaryPanel
          summary={summary}
          deliveries={deliveries}
          groups={<GroupsSummary />}
          now={now}
          onOpenAgent={openAgent}
          askActions={askActions}
          onShowRoom={(roomKey) => {
            if (viewportWidth <= 640) setOpen(false);
            showRoom(roomKey);
          }}
        />
      </WorldPanel>
    ) : null,
  };
}
