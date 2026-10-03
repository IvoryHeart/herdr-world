import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConnectionClient } from "../api";
import { worldSessionStorage } from "../browserStorage";
import { useConnectionClient } from "../useConnectionClient";
import {
  fetchFullReport,
  formatSpan,
  IDLE_WINDOW_MS,
  isRecent,
  operationalAgents,
  receiptIdentity,
  receiptEndedAt,
  type ReceiptState,
  type TurnReceipt,
  useHandledTurns,
  useNow,
  useObservedStops,
  useRecentOpens,
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
  /** No receipt has been read for the agent's present state yet. */
  pending: boolean;
  since: number | null;
};

function handoffId(
  leaf: WorldLeafObject,
  receipt: TurnReceipt | null,
  stoppedAt: number | undefined,
) {
  // Scoped to the agent session and runtime, so marking one agent's stop can
  // never hide another session's stop with a matching turn id.
  return JSON.stringify([
    receiptIdentity(leaf),
    receipt?.turn_id ?? `stop:${stoppedAt ?? leaf.lastActivityAt ?? ""}`,
  ]);
}

function where(leaf: WorldLeafObject) {
  return [leaf.spaceLabel, leaf.tabLabel, agentFolder(leaf)]
    .filter(Boolean)
    .join(" › ");
}

/**
 * What the operator recognizes an agent by: the name they gave it, otherwise
 * the harness's own thread title, otherwise the harness.
 */
function agentName(leaf: WorldLeafObject) {
  return leaf.agentName ?? leaf.terminalTitle ?? leaf.agentLabel ?? leaf.label;
}

/** Harness and model, so the operator can tell what each agent runs on. */
function agentRuntime(leaf: WorldLeafObject) {
  return [
    leaf.agentName || leaf.terminalTitle ? leaf.agentLabel : null,
    leaf.modelLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function partitionDesk(
  agents: WorldLeafObject[],
  receiptFor: (leaf: WorldLeafObject) => ReceiptState,
  handled: Set<string>,
  now: number,
  stops: Map<string, number> = new Map(),
) {
  const needs: Item[] = [];
  const review: Item[] = [];
  const working: Item[] = [];
  const quiet: WorldLeafObject[] = [];
  for (const leaf of agents) {
    // A receipt read for an earlier state may name an earlier stop, so marking
    // waits until the receipt matches the agent's present state.
    const { receipt, current } = receiptFor(leaf);
    const pending = !current;
    const stoppedAt = stops.get(receiptIdentity(leaf));
    const id = handoffId(leaf, receipt, stoppedAt);
    const since =
      receiptEndedAt(receipt) ?? stoppedAt ?? leaf.lastActivityAt ?? null;
    if (leaf.status === "blocked") {
      needs.push({
        lane: "needs",
        leaf,
        receipt,
        handoffId: id,
        pending,
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
        pending,
        handled: false,
        since: Number.isFinite(started) ? started : null,
      });
    } else if (
      leaf.status === "done" ||
      isRecent(receipt, now) ||
      (stoppedAt !== undefined && now - stoppedAt <= IDLE_WINDOW_MS)
    ) {
      review.push({
        lane: "review",
        leaf,
        receipt,
        handoffId: id,
        pending,
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

/** Read-only summaries of managed hosts other than the selected one. */
export function otherHostSummaries(world: WorldObject): Elsewhere[] {
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

/** Whether a media query matches, updating as the viewport changes. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.(query).matches === true,
  );
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export type DeskMode = "now" | "agents" | "reviewed";
const DESK_MODES: { mode: DeskMode; label: string }[] = [
  { mode: "now", label: "Now" },
  { mode: "agents", label: "Agents" },
  { mode: "reviewed", label: "Reviewed" },
];
const RECENT_LIMIT = 6;

/** The folder an agent works in, which tells same-named tabs apart. */
export function agentFolder(leaf: WorldLeafObject) {
  const cwd = leaf.pane.foreground_cwd ?? leaf.pane.cwd;
  if (!cwd) return null;
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

/**
 * Whether an agent matches every word of a search across the things an
 * operator remembers: its name, harness, workspace, tab, folder, request and
 * report.
 */
export function matchesQuery(
  leaf: WorldLeafObject,
  receipt: TurnReceipt | null,
  query: string,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    leaf.agentName,
    leaf.terminalTitle,
    leaf.agentLabel,
    leaf.modelLabel,
    leaf.label,
    leaf.spaceLabel,
    leaf.tabLabel,
    agentFolder(leaf),
    leaf.taskSummary,
    receipt?.ask,
    receipt?.report,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export type DirectoryGroup = {
  /** Connection-qualified workspace identity. */
  key: string;
  /** Heading; disambiguated by folder when two workspaces share a label. */
  workspace: string;
  agents: WorldLeafObject[];
};

/**
 * Every agent, most recently active first: a "Recently opened" shortlist from
 * the Desk, then workspaces ordered by their most recent agent.
 */
export function agentDirectory(
  agents: readonly WorldLeafObject[],
  activeAt: (leaf: WorldLeafObject) => number | null,
  openedAt: (leaf: WorldLeafObject) => number | null,
): { recent: WorldLeafObject[]; groups: DirectoryGroup[] } {
  const newest = (left: WorldLeafObject, right: WorldLeafObject) =>
    (activeAt(right) ?? 0) - (activeAt(left) ?? 0);
  const recent = agents
    .filter((leaf) => openedAt(leaf) !== null)
    .sort((left, right) => (openedAt(right) ?? 0) - (openedAt(left) ?? 0))
    .slice(0, RECENT_LIMIT);
  // Group by workspace identity, not its display label: two checkouts named
  // after the same repository are different workspaces.
  const byWorkspace = new Map<string, WorldLeafObject[]>();
  for (const leaf of agents) {
    const key = JSON.stringify([leaf.connectionId, leaf.pane.workspace_id]);
    const group = byWorkspace.get(key) ?? [];
    group.push(leaf);
    byWorkspace.set(key, group);
  }
  const labelCounts = new Map<string, number>();
  for (const members of byWorkspace.values())
    labelCounts.set(
      members[0].spaceLabel,
      (labelCounts.get(members[0].spaceLabel) ?? 0) + 1,
    );
  const groups = [...byWorkspace].map(([key, members]) => {
    const label = members[0].spaceLabel;
    const folder = agentFolder(members[0]);
    return {
      key,
      workspace:
        (labelCounts.get(label) ?? 0) > 1 && folder
          ? `${label} (${folder})`
          : label,
      agents: [...members].sort(newest),
    };
  });
  groups.sort((left, right) => newest(left.agents[0], right.agents[0]));
  return { recent, groups };
}

export type DeskShortcut = "next" | "previous" | "open" | "mark" | null;

/**
 * Decides what a key does on the Desk. Keys aimed elsewhere in the app, at
 * editable fields or with modifiers do nothing, and Enter keeps its native
 * meaning on any focused control.
 */
export function deskShortcut(input: {
  key: string;
  modified: boolean;
  onDesk: boolean;
  editable: boolean;
  control: boolean;
}): DeskShortcut {
  if (input.modified || !input.onDesk || input.editable) return null;
  if (input.key === "j" || input.key === "ArrowDown") return "next";
  if (input.key === "k" || input.key === "ArrowUp") return "previous";
  if (input.key === "Enter") return input.control ? null : "open";
  if (input.key === "e") return "mark";
  return null;
}

/** The focused card's position, following the agent as lanes reorder. */
export function focusIndexOf(
  order: readonly { leaf: { id: string } }[],
  focusedId: string | null,
  fallback = 0,
) {
  const index = order.findIndex((item) => item.leaf.id === focusedId);
  // A focused agent that left the list hands focus to the card now nearest
  // its last position, not to the top of the queue.
  return index >= 0 ? index : Math.max(0, Math.min(fallback, order.length - 1));
}

export function DeskView(props: {
  world: WorldObject;
  aggregate?: WorldObject;
  onOpenTerminal(id: string): Promise<void>;
  reading?: string | null;
  onPreview?: ((id: string) => Promise<void>) | null;
  onCloseReading?: () => void;
}) {
  const client = useConnectionClient();
  return <DeskBoard {...props} client={client} />;
}

/** The Desk for one selected-host connection client. */
export function DeskBoard({
  world,
  aggregate,
  client,
  onOpenTerminal,
  reading = null,
  onPreview = null,
  onCloseReading,
}: {
  world: WorldObject;
  aggregate?: WorldObject;
  client: ConnectionClient;
  onOpenTerminal(id: string): Promise<void>;
  /** The agent shown in the docked reading pane, on wide screens. */
  reading?: string | null;
  onPreview?: ((id: string) => Promise<void>) | null;
  onCloseReading?: () => void;
}) {
  const now = useNow(10_000);
  const agents = useMemo(() => operationalAgents(world), [world]);
  const receiptFor = useTurnReceipts(agents, client);
  const { handled, mark } = useHandledTurns(client.connectionId);
  const stops = useObservedStops(client.connectionId, agents);
  const { opens, record: recordOpen } = useRecentOpens(client.connectionId);
  const [mode, setModeState] = useState<DeskMode>(() => {
    try {
      // The mode lasts for this browser session; a fresh visit triages first.
      const saved = worldSessionStorage.getItem("desk.mode.v1");
      return saved === "agents" || saved === "reviewed" ? saved : "now";
    } catch {
      return "now";
    }
  });
  const setMode = (next: DeskMode) => {
    setModeState(next);
    try {
      worldSessionStorage.setItem("desk.mode.v1", next);
    } catch {
      // The chosen mode is a browser convenience.
    }
  };
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ id: string; name: string } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullReports, setFullReports] = useState<Map<string, string>>(
    () => new Map(),
  );
  // Focus follows an agent, not a position: lanes reorder as agents change.
  const [focusedId, setFocusedId] = useState<string | null>(null);
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
  const matches = (item: Item) => matchesQuery(item.leaf, item.receipt, query);
  const shownNeeds = needs.filter(matches);
  const shownReview = pendingReview.filter(matches);
  const shownWorking = working.filter(matches);
  const reviewed = review
    .filter((item) => item.handled)
    .sort((left, right) => (right.since ?? 0) - (left.since ?? 0));
  const shownReviewed = reviewed.filter(matches);
  const shownQuiet = quiet.filter((leaf) =>
    matchesQuery(leaf, receiptFor(leaf).receipt, query),
  );
  const openedAt = (leaf: WorldLeafObject) =>
    opens.get(receiptIdentity(leaf)) ?? null;
  const activeAt = (leaf: WorldLeafObject) => {
    const candidates = [
      receiptEndedAt(receiptFor(leaf).receipt),
      stops.get(receiptIdentity(leaf)) ?? null,
      leaf.lastActivityAt ?? null,
      openedAt(leaf),
    ].filter((value): value is number => typeof value === "number");
    return candidates.length ? Math.max(...candidates) : null;
  };
  const directory = agentDirectory(
    agents.filter((leaf) =>
      matchesQuery(leaf, receiptFor(leaf).receipt, query),
    ),
    activeAt,
    openedAt,
  );
  const directoryCount = directory.groups.reduce(
    (total, group) => total + group.agents.length,
    0,
  );
  const screenTargets = useMemo(
    () =>
      agents.filter(
        (leaf) =>
          leaf.status === "blocked" ||
          leaf.status === "working" ||
          leaf.status === "done" ||
          stops.has(receiptIdentity(leaf)),
      ),
    [agents, stops],
  );
  const screens = usePaneScreens(screenTargets, client);
  // Keyboard order is the list the operator is looking at.
  const order: { leaf: WorldLeafObject; item?: Item }[] =
    mode === "now"
      ? [...shownNeeds, ...shownReview, ...shownWorking].map((item) => ({
          leaf: item.leaf,
          item,
        }))
      : mode === "reviewed"
        ? shownReviewed.map((item) => ({ leaf: item.leaf, item }))
        : [
            ...new Map(
              [
                ...directory.recent,
                ...directory.groups.flatMap((group) => group.agents),
              ].map((leaf) => [leaf.id, { leaf }]),
            ).values(),
          ];
  // Other hosts come from the aggregate observation, never the selected-host
  // projection, and are summaries only.
  const others = otherHostSummaries(aggregate ?? world);
  const hostLabel =
    world.hosts.find((host) => host.selectedHost)?.label ?? "this host";
  const oldestWait = needs[0]?.since ? formatSpan(now - needs[0].since) : null;

  const lastFocusIndex = useRef(0);
  const focusIndex = focusIndexOf(order, focusedId, lastFocusIndex.current);
  lastFocusIndex.current = focusIndex;
  const focused = order[focusIndex];
  const open = (leaf: WorldLeafObject) => {
    setError(null);
    recordOpen(leaf);
    void onOpenTerminal(leaf.id).catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : "Could not open terminal",
      ),
    );
  };

  const toggleReviewed = (item: Item) => {
    mark(item.handoffId, !item.handled);
    setToast(
      item.handled ? null : { id: item.handoffId, name: agentName(item.leaf) },
    );
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // "/" jumps to search from anywhere on the Desk.
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (target === document.body || rootRef.current?.contains(target)) &&
        !target?.closest?.("input, textarea, select")
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (
        event.key === "Escape" &&
        reading &&
        (target === document.body || rootRef.current?.contains(target)) &&
        !target?.closest?.("input, textarea, select")
      ) {
        event.preventDefault();
        onCloseReading?.();
        return;
      }
      if (!order.length) return;
      const action = deskShortcut({
        key: event.key,
        modified: event.metaKey || event.ctrlKey || event.altKey,
        // Shortcuts belong to the Desk: ignore keys aimed at the rest of the
        // app (top bar, Inspector windows, terminals, dialogs).
        onDesk:
          !target ||
          target === document.body ||
          rootRef.current?.contains(target) === true,
        editable: Boolean(
          target?.isContentEditable ||
            target?.closest?.("input, textarea, select, [role='dialog']"),
        ),
        control: Boolean(
          target?.closest?.(
            "button, a, summary, label, [role='button'], [role='menuitem'], [role='checkbox']",
          ),
        ),
      });
      const move = (step: number) => {
        const next =
          order[Math.min(order.length - 1, Math.max(0, focusIndex + step))];
        if (!next) return;
        setFocusedId(next.leaf.id);
        // With the reading pane open, moving previews the next agent there.
        if (reading && onPreview) void onPreview(next.leaf.id).catch(() => {});
        // Keep DOM focus on the highlighted card so Enter and E act on it.
        rootRef.current
          ?.querySelector<HTMLElement>(
            `[data-desk-card="${CSS.escape(next.leaf.id)}"]`,
          )
          ?.focus({ preventScroll: true });
      };
      if (action === "next") {
        event.preventDefault();
        move(1);
      } else if (action === "previous") {
        event.preventDefault();
        move(-1);
      } else if (action === "open" && focused) {
        event.preventDefault();
        open(focused.leaf);
      } else if (
        action === "mark" &&
        focused?.item?.lane === "review" &&
        !focused.item.pending
      ) {
        event.preventDefault();
        // Marking moves the item out of this list; keep the operator's place.
        const neighbour = order[focusIndex + 1] ?? order[focusIndex - 1];
        setFocusedId(neighbour?.leaf.id ?? null);
        toggleReviewed(focused.item);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    rootRef.current
      ?.querySelector(".desk-card.is-focused")
      ?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const card = (item: Item) => {
    const index = order.indexOf(item);
    const { leaf, receipt } = item;
    const screen = screens(leaf) ?? "";
    const isFocused = index === focusIndex;
    const ask = receipt?.ask ?? leaf.taskSummary ?? null;
    const age = item.since ? formatSpan(now - item.since) : null;
    const isExpanded = expanded === item.handoffId;
    return (
      <li
        key={leaf.id}
        className={`desk-card is-${item.lane}${item.handled ? " is-handled" : ""}${isFocused ? " is-focused" : ""}${reading === leaf.id ? " is-reading" : ""}`}
        data-desk-card={leaf.id}
        tabIndex={-1}
        // The active card follows keyboard and pointer focus, never hover.
        onFocus={() => setFocusedId(leaf.id)}
        onPointerDown={() => setFocusedId(leaf.id)}
        // On wide screens, clicking a card's text reads it in the side pane.
        onClick={(event) => {
          if (
            onPreview &&
            !(event.target as HTMLElement).closest("button, a, summary, pre")
          )
            void onPreview(leaf.id).catch(() => {});
        }}
      >
        <div className="desk-card-head">
          <span className="desk-card-name">{agentName(leaf)}</span>
          <span className="desk-card-where">
            {[agentRuntime(leaf), where(leaf)].filter(Boolean).join(" · ")}
          </span>
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
              {isExpanded
                ? (fullReports.get(item.handoffId) ?? receipt.report)
                : receipt.report}
            </p>
            {receipt.report.length > 360 || receipt.report_truncated ? (
              <button
                type="button"
                className="desk-link"
                onClick={() => {
                  if (isExpanded) return setExpanded(null);
                  setExpanded(item.handoffId);
                  if (
                    receipt.report_truncated &&
                    !fullReports.has(item.handoffId)
                  )
                    void fetchFullReport(client, leaf, receipt.turn_id)
                      .then((full) => {
                        if (full)
                          setFullReports((current) =>
                            new Map(current).set(item.handoffId, full),
                          );
                      })
                      .catch(() => {});
                }}
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
              disabled={item.pending}
              title={
                item.pending ? "Waiting for this turn's receipt" : undefined
              }
              onClick={() => toggleReviewed(item)}
            >
              {item.handled ? "Reopen" : "Mark reviewed"}
              <kbd>E</kbd>
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  const statusLabel: Record<string, string> = {
    blocked: "Needs you",
    done: "Done",
    working: "Working",
    idle: "Idle",
    unknown: "Unknown",
  };
  const row = (leaf: WorldLeafObject, showWorkspace = false) => {
    const { receipt } = receiptFor(leaf);
    const line = receipt?.ask ?? leaf.taskSummary ?? null;
    const at = activeAt(leaf);
    const meta = [
      agentRuntime(leaf),
      showWorkspace ? leaf.spaceLabel : null,
      leaf.tabLabel ? `tab ${leaf.tabLabel}` : null,
      agentFolder(leaf),
    ].filter(Boolean);
    return (
      <li key={leaf.id}>
        <button
          type="button"
          className={`desk-row is-${leaf.status}${focusedId === leaf.id && mode === "agents" ? " is-focused" : ""}${reading === leaf.id ? " is-reading" : ""}`}
          data-desk-card={leaf.id}
          onFocus={() => setFocusedId(leaf.id)}
          onClick={() => open(leaf)}
        >
          <span className="desk-row-status">
            {statusLabel[leaf.status] ?? leaf.status}
          </span>
          <span className="desk-row-main">
            <span className="desk-row-title">
              <strong>{agentName(leaf)}</strong>
              <small>{meta.join(" · ")}</small>
            </span>
            {line ? <span className="desk-row-line">{line}</span> : null}
          </span>
          <span className="desk-row-age">
            {at ? `${formatSpan(now - at)} ago` : ""}
          </span>
        </button>
      </li>
    );
  };
  const modeCount: Record<DeskMode, number> = {
    now: needs.length + pendingReview.length + working.length,
    agents: agents.length,
    reviewed: reviewed.length,
  };
  const noMatch = (
    <p className="desk-empty">Nothing here matches &ldquo;{query}&rdquo;.</p>
  );

  return (
    <div
      className={`desk is-${mode}${reading ? " has-reading" : ""}`}
      ref={rootRef}
    >
      <header className="desk-top">
        <div className="desk-summary" aria-label="Attention summary">
          <button
            type="button"
            className={`desk-stat is-needs${needs.length ? " is-hot" : ""}`}
            onClick={() => setMode("now")}
          >
            <strong>{needs.length}</strong>
            <span>
              need{needs.length === 1 ? "s" : ""} you
              {oldestWait ? <em>oldest {oldestWait}</em> : null}
            </span>
          </button>
          <button
            type="button"
            className="desk-stat is-review"
            onClick={() => setMode("now")}
          >
            <strong>{pendingReview.length}</strong>
            <span>to review</span>
          </button>
          <button
            type="button"
            className="desk-stat"
            onClick={() => setMode("now")}
          >
            <strong>{working.length}</strong>
            <span>working</span>
          </button>
          <button
            type="button"
            className="desk-stat is-quiet"
            onClick={() => setMode("agents")}
          >
            <strong>{quiet.length}</strong>
            <span>quiet</span>
          </button>
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
        </div>
        <div className="desk-controls">
          <div className="desk-modes" role="tablist" aria-label="Desk views">
            {DESK_MODES.map((candidate) => (
              <button
                key={candidate.mode}
                type="button"
                role="tab"
                aria-selected={mode === candidate.mode}
                className={mode === candidate.mode ? "is-active" : ""}
                onClick={() => setMode(candidate.mode)}
              >
                {candidate.label}
                <span className="desk-mode-count">
                  {modeCount[candidate.mode]}
                </span>
              </button>
            ))}
          </div>
          <label className="desk-search">
            <span className="desk-search-label">Find</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Agent, workspace, tab, folder or request"
              aria-label="Find an agent"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
      </header>
      {error ? (
        <p className="desk-error" role="alert">
          {error}
        </p>
      ) : null}
      {mode === "now" ? (
        <div className="desk-lanes">
          <section className="desk-lane is-needs" aria-label="Needs you">
            <h2>
              Needs you <small>questions and approvals, oldest first</small>
            </h2>
            {shownNeeds.length ? (
              <ol>{shownNeeds.map(card)}</ol>
            ) : query && needs.length ? (
              noMatch
            ) : (
              <p className="desk-empty">Nobody is waiting on you.</p>
            )}
          </section>
          <section className="desk-lane is-review" aria-label="To review">
            <h2>
              To review <small>finished turns and what they produced</small>
              {reviewed.length ? (
                <button
                  type="button"
                  className="desk-link desk-lane-link"
                  onClick={() => setMode("reviewed")}
                >
                  {reviewed.length} reviewed
                </button>
              ) : null}
            </h2>
            {shownReview.length ? (
              <ol>{shownReview.map(card)}</ol>
            ) : query && pendingReview.length ? (
              noMatch
            ) : (
              <p className="desk-empty">
                Nothing to review. Finished turns land here with the request,
                the agent&rsquo;s report and the files it edited.
              </p>
            )}
          </section>
          <section className="desk-lane is-working" aria-label="In flight">
            <h2>
              In flight <small>live from each terminal</small>
            </h2>
            {shownWorking.length ? (
              <ol>{shownWorking.map(card)}</ol>
            ) : query && working.length ? (
              noMatch
            ) : (
              <p className="desk-empty">No agent is working right now.</p>
            )}
            {shownQuiet.length ? (
              <details className="desk-quiet">
                <summary>
                  {shownQuiet.length} quiet agent
                  {shownQuiet.length === 1 ? "" : "s"}
                </summary>
                <ul className="desk-rows">
                  {shownQuiet.map((leaf) => row(leaf, true))}
                </ul>
              </details>
            ) : null}
          </section>
        </div>
      ) : mode === "agents" ? (
        <section className="desk-directory" aria-label="Agents">
          {query && !directoryCount ? noMatch : null}
          {directory.recent.length ? (
            <div className="desk-group is-recent">
              <h3>
                Recently opened <small>from the Desk, newest first</small>
              </h3>
              <ul className="desk-rows">
                {directory.recent.map((leaf) => row(leaf, true))}
              </ul>
            </div>
          ) : null}
          {directory.groups.map((group) => (
            <div className="desk-group" key={group.key}>
              <h3>
                {group.workspace}
                <small>
                  {group.agents.length} agent
                  {group.agents.length === 1 ? "" : "s"}
                </small>
              </h3>
              <ul className="desk-rows">
                {group.agents.map((leaf) => row(leaf))}
              </ul>
            </div>
          ))}
          {!agents.length ? (
            <p className="desk-empty">No agents on {hostLabel}.</p>
          ) : null}
        </section>
      ) : (
        <section
          className="desk-lane is-review desk-reviewed"
          aria-label="Reviewed"
        >
          <h2>
            Reviewed{" "}
            <small>
              each agent&rsquo;s latest stop you marked, while it stays idle or
              done
            </small>
          </h2>
          {shownReviewed.length ? (
            <ol>{shownReviewed.map(card)}</ol>
          ) : query && reviewed.length ? (
            noMatch
          ) : (
            <p className="desk-empty">
              Nothing marked reviewed yet. An agent&rsquo;s latest stop stays
              here after you mark it until the agent works again; every agent is
              always under Agents.
            </p>
          )}
        </section>
      )}
      {toast ? (
        <div className="desk-toast" role="status">
          <span>
            Marked <strong>{toast.name}</strong> reviewed
          </span>
          <button
            type="button"
            onClick={() => {
              mark(toast.id, false);
              setToast(null);
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="desk-toast-link"
            onClick={() => {
              setToast(null);
              setMode("reviewed");
            }}
          >
            See reviewed
          </button>
        </div>
      ) : null}
      <footer className="desk-keys" aria-hidden="true">
        <span>
          <kbd>/</kbd> find
        </span>
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
        {reading ? (
          <span>
            <kbd>Esc</kbd> close pane
          </span>
        ) : null}
      </footer>
    </div>
  );
}

export default DeskView;
