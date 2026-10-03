import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConnectionClient } from "../useConnectionClient";
import {
  formatSpan,
  IDLE_WINDOW_MS,
  isRecent,
  operationalAgents,
  receiptEndedAt,
  type TurnReceipt,
  useHandledTurns,
  useNow,
  useObservedStops,
  useTurnReceipts,
} from "./handoffs";
import {
  activityFromScreen,
  questionFromScreen,
  usePaneScreens,
} from "./paneScreen";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import "./DeskView.css";

type Lane = "needs" | "review" | "working";
type Item = {
  lane: Lane;
  leaf: WorldLeafObject;
  receipt: TurnReceipt | null;
  handoffId: string;
  handled: boolean;
  since: number | null;
};

function handoffId(
  leaf: WorldLeafObject,
  receipt: TurnReceipt | null,
  stoppedAt: number | undefined,
) {
  return (
    receipt?.turn_id ??
    `${leaf.id}|${leaf.agentSessionFingerprint ?? ""}|${stoppedAt ?? leaf.lastActivityAt ?? ""}`
  );
}

function where(leaf: WorldLeafObject) {
  return [leaf.spaceLabel, leaf.tabLabel].filter(Boolean).join(" › ");
}

function agentName(leaf: WorldLeafObject) {
  return leaf.agentLabel ?? leaf.label;
}

export function partitionDesk(
  agents: WorldLeafObject[],
  receiptFor: (leaf: WorldLeafObject) => TurnReceipt | null | undefined,
  handled: Set<string>,
  now: number,
  stops: Map<string, number> = new Map(),
) {
  const needs: Item[] = [];
  const review: Item[] = [];
  const working: Item[] = [];
  const quiet: WorldLeafObject[] = [];
  for (const leaf of agents) {
    const receipt = receiptFor(leaf) ?? null;
    const stoppedAt = stops.get(leaf.id);
    const id = handoffId(leaf, receipt, stoppedAt);
    const since =
      receiptEndedAt(receipt) ?? stoppedAt ?? leaf.lastActivityAt ?? null;
    if (leaf.status === "blocked") {
      needs.push({
        lane: "needs",
        leaf,
        receipt,
        handoffId: id,
        handled: false,
        since,
      });
    } else if (leaf.status === "working") {
      const started = Date.parse(receipt?.started_at ?? "");
      working.push({
        lane: "working",
        leaf,
        receipt,
        handoffId: id,
        handled: false,
        since: Number.isFinite(started) ? started : null,
      });
    } else if (
      leaf.status === "done" ||
      (leaf.status !== "idle" && leaf.status !== "unknown") ||
      isRecent(receipt, now) ||
      (stoppedAt !== undefined && now - stoppedAt <= IDLE_WINDOW_MS)
    ) {
      review.push({
        lane: "review",
        leaf,
        receipt,
        handoffId: id,
        handled: handled.has(id),
        since,
      });
    } else quiet.push(leaf);
  }
  const oldestFirst = (left: Item, right: Item) =>
    (left.since ?? Number.MAX_SAFE_INTEGER) -
    (right.since ?? Number.MAX_SAFE_INTEGER);
  needs.sort(oldestFirst);
  review.sort(
    (left, right) =>
      Number(left.handled) - Number(right.handled) || oldestFirst(left, right),
  );
  working.sort(oldestFirst);
  return { needs, review, working, quiet };
}

type Elsewhere = {
  connectionId: string;
  label: string;
  stale: boolean;
  needs: number;
  done: number;
  working: number;
};

function elsewhere(world: WorldObject): Elsewhere[] {
  const hosts = new Map<string, Elsewhere>();
  for (const leaf of world.leaves) {
    if (leaf.kind !== "agent" || leaf.selectedHost) continue;
    const host = hosts.get(leaf.connectionId) ?? {
      connectionId: leaf.connectionId,
      label: leaf.hostLabel,
      stale: false,
      needs: 0,
      done: 0,
      working: 0,
    };
    host.stale ||= leaf.stale;
    if (leaf.status === "blocked") host.needs += 1;
    else if (leaf.status === "done") host.done += 1;
    else if (leaf.status === "working") host.working += 1;
    hosts.set(leaf.connectionId, host);
  }
  return [...hosts.values()];
}

function Screen({
  lines,
  live,
  fallback,
}: {
  lines: string[];
  live?: boolean;
  fallback: string;
}) {
  const ref = useRef<HTMLPreElement | null>(null);
  // Follow the newest lines (the question and its choices) unless the reader
  // has scrolled up to read earlier output.
  const pinned = useRef(true);
  const text = lines.join("\n");
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [text]);
  if (!lines.length) return <p className="desk-card-missing">{fallback}</p>;
  return (
    <pre
      ref={ref}
      className={`desk-screen${live ? " is-live" : ""}`}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      {text}
    </pre>
  );
}

export function DeskView({
  world,
  onOpenTerminal,
}: {
  world: WorldObject;
  onOpenTerminal(id: string): Promise<void>;
}) {
  const client = useConnectionClient();
  const now = useNow(10_000);
  const agents = useMemo(() => operationalAgents(world), [world]);
  const receiptFor = useTurnReceipts(agents, client);
  const { handled, mark } = useHandledTurns(client.connectionId);
  const stops = useObservedStops(client.connectionId, agents);
  const [showReviewed, setShowReviewed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { needs, review, working, quiet } = partitionDesk(
    agents,
    receiptFor,
    handled,
    now,
    stops,
  );
  const pendingReview = review.filter((item) => !item.handled);
  const shownReview = showReviewed ? review : pendingReview;
  const reviewedCount = review.length - pendingReview.length;
  const screenTargets = useMemo(
    () =>
      agents.filter(
        (leaf) =>
          leaf.status === "blocked" ||
          leaf.status === "working" ||
          leaf.status === "done" ||
          stops.has(leaf.id),
      ),
    [agents, stops],
  );
  const screens = usePaneScreens(screenTargets, client);
  const order = [...needs, ...shownReview, ...working];
  const others = elsewhere(world);
  const hostLabel =
    world.hosts.find((host) => host.selectedHost)?.label ?? "this host";
  const oldestWait = needs[0]?.since ? formatSpan(now - needs[0].since) : null;

  const focused = order[Math.min(focus, order.length - 1)];
  const open = (leaf: WorldLeafObject) => {
    setError(null);
    void onOpenTerminal(leaf.id).catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : "Could not open terminal",
      ),
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) ||
        target?.closest?.(".xterm, [role='dialog']")
      )
        return;
      if (!order.length) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setFocus((value) => Math.min(order.length - 1, value + 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocus((value) => Math.max(0, value - 1));
      } else if (event.key === "Enter" && focused) {
        event.preventDefault();
        open(focused.leaf);
      } else if (event.key === "e" && focused?.lane === "review") {
        event.preventDefault();
        mark(focused.handoffId, !focused.handled);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    rootRef.current
      ?.querySelector(".desk-card.is-focused")
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const card = (item: Item) => {
    const index = order.indexOf(item);
    const { leaf, receipt } = item;
    const screen = screens.get(leaf.id) ?? "";
    const isFocused = index === Math.min(focus, order.length - 1);
    const ask = receipt?.ask ?? leaf.taskSummary ?? null;
    const age = item.since ? formatSpan(now - item.since) : null;
    const isExpanded = expanded === item.handoffId;
    return (
      <li
        key={leaf.id}
        className={`desk-card is-${item.lane}${item.handled ? " is-handled" : ""}${isFocused ? " is-focused" : ""}`}
        onMouseEnter={() => index >= 0 && setFocus(index)}
      >
        <div className="desk-card-head">
          <span className="desk-card-name">{agentName(leaf)}</span>
          <span className="desk-card-where">{where(leaf)}</span>
          {age ? (
            <span className="desk-card-age">
              {item.lane === "needs"
                ? `waiting ${age}`
                : item.lane === "working"
                  ? `running ${age}`
                  : `${age} ago`}
            </span>
          ) : null}
        </div>
        {ask ? (
          <p className="desk-card-ask">
            <span>{item.lane === "working" ? "On" : "You asked"}</span>
            {ask}
          </p>
        ) : null}
        {item.lane === "needs" ? (
          <Screen
            lines={
              screen
                ? questionFromScreen(screen)
                : receipt?.report
                  ? [receipt.report]
                  : []
            }
            fallback="Waiting for your answer in its terminal."
          />
        ) : item.lane === "working" ? (
          <Screen lines={activityFromScreen(screen)} live fallback="Working…" />
        ) : receipt?.report ? (
          <>
            <p
              className={`desk-card-report${isExpanded ? " is-expanded" : ""}`}
            >
              {receipt.report}
            </p>
            {receipt.report.length > 360 ? (
              <button
                type="button"
                className="desk-link"
                onClick={() => setExpanded(isExpanded ? null : item.handoffId)}
              >
                {isExpanded ? "Show less" : "Read all"}
              </button>
            ) : null}
          </>
        ) : (
          <Screen
            lines={activityFromScreen(screen, 5)}
            fallback="Finished its turn without a readable transcript. Open it to read the result."
          />
        )}
        {receipt && item.lane !== "needs" ? (
          <div className="desk-card-facts">
            {[
              receipt.duration_ms !== null && item.lane === "review"
                ? `ran ${formatSpan(receipt.duration_ms)}`
                : null,
              `${receipt.tool_calls} tool call${receipt.tool_calls === 1 ? "" : "s"}`,
              receipt.files.length
                ? `${receipt.files.length}${receipt.files_truncated ? "+" : ""} file${receipt.files.length === 1 ? "" : "s"} edited`
                : "no files edited",
            ]
              .filter(Boolean)
              .join(" · ")}
            {receipt.files.length ? (
              <ul>
                {receipt.files.slice(0, 5).map((path) => (
                  <li key={path} title={path}>
                    {path.split("/").pop()}
                  </li>
                ))}
                {receipt.files.length > 5 ? (
                  <li>+{receipt.files.length - 5}</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="desk-card-actions">
          <button
            type="button"
            className="is-primary"
            onClick={() => open(leaf)}
          >
            {item.lane === "needs"
              ? "Answer"
              : item.lane === "review"
                ? "Open"
                : "Watch"}
            <kbd>↵</kbd>
          </button>
          {item.lane === "review" ? (
            <button
              type="button"
              onClick={() => mark(item.handoffId, !item.handled)}
            >
              {item.handled ? "Reopen" : "Mark reviewed"}
              <kbd>E</kbd>
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="desk" ref={rootRef}>
      <header className="desk-summary" aria-label="Attention summary">
        <div className={`desk-stat is-needs${needs.length ? " is-hot" : ""}`}>
          <strong>{needs.length}</strong>
          <span>
            need{needs.length === 1 ? "s" : ""} you
            {oldestWait ? <em>oldest {oldestWait}</em> : null}
          </span>
        </div>
        <div className="desk-stat is-review">
          <strong>{pendingReview.length}</strong>
          <span>to review</span>
        </div>
        <div className="desk-stat">
          <strong>{working.length}</strong>
          <span>working</span>
        </div>
        <div className="desk-stat is-quiet">
          <strong>{quiet.length}</strong>
          <span>quiet</span>
        </div>
        <div className="desk-hosts">
          <span className="desk-host is-selected">{hostLabel}</span>
          {others.map((host) => (
            <span
              key={host.connectionId}
              className={`desk-host${host.needs ? " has-needs" : ""}`}
              title={
                host.stale
                  ? "Cached observation; switch hosts to act"
                  : "Observed in the background; switch hosts to act"
              }
            >
              {host.label}
              {host.needs ? ` · ${host.needs} need you` : ""}
              {host.done ? ` · ${host.done} done` : ""}
              {host.working ? ` · ${host.working} working` : ""}
              {!host.needs && !host.done && !host.working ? " · quiet" : ""}
            </span>
          ))}
        </div>
      </header>
      {error ? (
        <p className="desk-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="desk-lanes">
        <section className="desk-lane is-needs" aria-label="Needs you">
          <h2>
            Needs you <small>questions and approvals, oldest first</small>
          </h2>
          {needs.length ? (
            <ol>{needs.map(card)}</ol>
          ) : (
            <p className="desk-empty">Nobody is waiting on you.</p>
          )}
        </section>
        <section className="desk-lane is-review" aria-label="To review">
          <h2>
            To review <small>finished turns and what they produced</small>
            {reviewedCount ? (
              <label className="desk-toggle">
                <input
                  type="checkbox"
                  checked={showReviewed}
                  onChange={(event) => setShowReviewed(event.target.checked)}
                />
                {reviewedCount} reviewed
              </label>
            ) : null}
          </h2>
          {shownReview.length ? (
            <ol>{shownReview.map(card)}</ol>
          ) : (
            <p className="desk-empty">
              Nothing to review. Finished turns land here with the request, the
              agent&rsquo;s report and the files it edited.
            </p>
          )}
        </section>
        <section className="desk-lane is-working" aria-label="In flight">
          <h2>
            In flight <small>live from each terminal</small>
          </h2>
          {working.length ? (
            <ol>{working.map(card)}</ol>
          ) : (
            <p className="desk-empty">No agent is working right now.</p>
          )}
          {quiet.length ? (
            <details className="desk-quiet">
              <summary>
                {quiet.length} quiet agent{quiet.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {quiet.map((leaf) => (
                  <li key={leaf.id}>
                    <button type="button" onClick={() => open(leaf)}>
                      <span>{agentName(leaf)}</span>
                      <small>{where(leaf)}</small>
                      <em>
                        {leaf.status}
                        {leaf.lastActivityAt
                          ? ` · ${formatSpan(now - leaf.lastActivityAt)} ago`
                          : ""}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>
      <footer className="desk-keys" aria-hidden="true">
        <span>
          <kbd>J</kbd>
          <kbd>K</kbd> move
        </span>
        <span>
          <kbd>↵</kbd> open terminal
        </span>
        <span>
          <kbd>E</kbd> mark reviewed
        </span>
      </footer>
    </div>
  );
}

export default DeskView;
