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
  type TownSummary as TownSummaryModel,
  type TownSummaryCounts,
  type TownSummaryItem,
} from "./townSummary";
import { TownSinceYouLeft } from "./TownSinceYouLeft";
import {
  townFuelGauge,
  townHarnessName,
  townLimits,
  townReachedText,
  townResetTime,
  townSeenAge,
} from "./townLimits";
import {
  townUsageStore,
  useTownUsage,
  type TownUsageState,
} from "./townPlaceUsage";
import type { UsageLimit } from "../../../../shared/usage";
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
  usage,
}: {
  summary: TownSummaryModel;
  now: number;
  /** Harness usage, whose `limits` each host lists; omitted, none show. */
  usage?: TownUsageState;
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
                // Herdr reports the session's last activity, not the moment
                // it finished, so the age says so.
                detail={
                  item.since === null
                    ? "done"
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
              {usage ? (
                <HostLimits
                  connectionId={host.connectionId}
                  usage={usage}
                  now={now}
                />
              ) : null}
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

/**
 * A host's subscription limits: each harness's windows with the percent used,
 * when each resets, where the numbers came from and how old they are. Stale
 * and missing numbers say so; a harness without a source says why.
 */
export function HostLimits({
  connectionId,
  usage,
  now,
}: {
  connectionId: string;
  usage: TownUsageState;
  now: number;
}) {
  if (usage.status !== "ready")
    return (
      <p className="town-summary-limits-note">
        {usage.status === "failed"
          ? "Limits are unavailable right now."
          : "Reading limits…"}
      </p>
    );
  const limits = townLimits(usage).filter(
    (limit) => limit.connection_id === connectionId,
  );
  if (!limits.length) return null;
  return (
    <ul className="town-summary-limits" aria-label="Subscription limits">
      {limits.map((limit) => (
        <HostLimit key={limit.harness} limit={limit} now={now} />
      ))}
    </ul>
  );
}

function HostLimit({ limit, now }: { limit: UsageLimit; now: number }) {
  const name = townHarnessName(limit.harness);
  const gauge = townFuelGauge(limit, now);
  if (!gauge)
    return (
      <li data-state={limit.state}>
        <span>{name}</span>
        <small>
          {limit.state === "unsupported"
            ? `Limits not available: ${limit.reason ?? "no source"}`
            : "Limits missing: none seen on this host"}
        </small>
      </li>
    );
  return (
    <li data-state={gauge.stale ? "stale" : "available"}>
      <span>
        {name}
        {gauge.stale ? <em> · stale</em> : null}
      </span>
      {gauge.windows.map((w) => (
        <small key={w.label} data-low={!gauge.stale && w.low}>
          {w.reached
            ? townReachedText(w)
            : `${w.label}: ${w.used} % used${!gauge.stale && w.low ? " (low)" : ""}`}{" "}
          ·{" "}
          {w.resetsAt === null
            ? "reset unknown"
            : `resets ${townResetTime(w.resetsAt)}`}
        </small>
      ))}
      <small>
        {gauge.source} · seen {townSeenAge(gauge.observedAt, now)}
      </small>
    </li>
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
            ? ` · blocked: ${item.agent.stateLabels.blocked?.trim() || "needs you"}`
            : ""}
        </strong>
        <small>
          {townLocation(item)} · {detail}
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
  /** "Since you left" after a return, for the board sign and phone chip. */
  sinceYouLeft: { board: ReactNode; chip: ReactNode };
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
  const usage = useTownUsage();
  const openOutbox = useCallback(() => {
    setOpen(true);
    setFocusKey((key) => key + 1);
    setDeliveryFocus((key) => key + 1);
  }, []);
  const sinceYouLeft = useMemo(
    () => ({
      board: <TownSinceYouLeft world={world} variant="board" />,
      chip: <TownSinceYouLeft world={world} variant="chip" />,
    }),
    [world],
  );
  const open = useCallback(() => {
    townUsageStore().request();
    setOpen(true);
    setFocusKey((key) => key + 1);
  }, []);
  return {
    sinceYouLeft,
    summary,
    deliveries,
    deliveryCount,
    deliveryWaiting,
    openOutbox,
    askActions,
    openTerminal,
    open,
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
          usage={usage}
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
