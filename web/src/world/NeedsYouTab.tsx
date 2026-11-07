import { ArrowLeft, Inbox, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AgentMark } from "../components/AgentMark";
import { useLayoutPreferences } from "../layoutPreferences";
import { useSystemBack } from "../systemBack";
import { useNow } from "./handoffs";
import { useReviewedWork } from "./useReviewedWork";
import {
  sharedAsksStore,
  useWorldAsks,
  type WorldAsksStore,
} from "./worldAsks";
import { useAnswerDeliveryCounts } from "./worldAnswerDeliveries";
import type { WorldDeskStore } from "./deskStateStore";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import {
  closeNeedsYou,
  needsYouCount,
  needsYouItems,
  needsYouLeafKey,
  needsYouState,
  openNeedsYou,
  subscribeNeedsYou,
  toggleNeedsYou,
  type NeedsYouItem,
  type NeedsYouState,
} from "./needsYou";
import { itemName, NeedsYouMessage } from "./NeedsYouItem";
import { askAttachmentUpload } from "./askAttachments";
import { preloadWorkspaceInspector } from "./inspectorPreload";
import "./needsYouTab.css";

/**
 * The list shows one page of this many items (each blocked or finished one
 * watches its conversation, so a page bounds the watches); an opener's
 * request turns it to the page holding that item.
 */
export const ITEM_LIMIT = 30;

export const useNeedsYouState = () =>
  useSyncExternalStore(subscribeNeedsYou, needsYouState, needsYouState);

type World = Pick<WorldObject, "leaves" | "nodeById">;

/** Questions and blocked agents, as the counter and the tab count them. */
function useWaitingCount(world: Pick<WorldObject, "leaves">) {
  const asks = useWorldAsks(sharedAsksStore());
  const blocked = useMemo(
    () =>
      world.leaves.filter(
        (leaf) =>
          leaf.kind === "agent" &&
          leaf.status === "blocked" &&
          leaf.actionable &&
          !leaf.stale,
      ).length,
    [world.leaves],
  );
  return asks.length + blocked;
}

/**
 * "Needs you N" in the existing top bar and Zen's picker: opens the tab. A
 * phone's top bar shows it compact, as an inbox icon with the Hosts icon's
 * count badge, hidden at zero.
 */
export function NeedsYouCounter({
  world,
  compact = false,
}: {
  world: Pick<WorldObject, "leaves">;
  compact?: boolean;
}) {
  const count = useWaitingCount(world);
  const { open } = useNeedsYouState();
  if (compact)
    return (
      <button
        type="button"
        className="needs-you-counter is-compact"
        aria-label={`Needs you, ${count}`}
        aria-pressed={open}
        title={open ? "Hide Needs you" : "Show Needs you"}
        onClick={toggleNeedsYou}
      >
        <Inbox size={16} aria-hidden="true" />
        {count ? (
          <b className="world-hosts-count" aria-hidden="true">
            {count}
          </b>
        ) : null}
      </button>
    );
  return (
    <button
      type="button"
      className="needs-you-counter"
      aria-label={`Needs you: ${count}`}
      aria-pressed={open}
      title={open ? "Hide Needs you" : "Show Needs you"}
      onClick={toggleNeedsYou}
    >
      <AgentMark kind={count ? "needs" : "idle"} />
      <span>Needs you</span>
      <b>{count}</b>
    </button>
  );
}

/**
 * Needs you as a tab on the left of every view. Closed, it is a small handle
 * at the left edge while anything waits; open, a list beside the view (over
 * it where the view is too narrow to share). On a phone it is a full-screen
 * list with Back; the counter opens it.
 */
export function NeedsYouHost({
  world,
  onChat,
  onOpenTerminal,
}: {
  world: World;
  /** Chat about this: the agent's Chat. */
  onChat(leafId: string): void;
  /** Answering in the Terminal: the agent's Terminal, never its Chat. */
  onOpenTerminal(leafId: string): void;
}) {
  const shared = useNeedsYouState();
  const { mobile } = useLayoutPreferences();
  const count = useWaitingCount(world);
  // A full screen on a phone: an agent window opened from it (Chat about
  // this) is a newer screen, so Back closes that first and returns here.
  useSystemBack(shared.open && mobile, closeNeedsYou, "screen");
  // Chat about this opens the Inspector; fetch it while the list is open.
  useEffect(
    () => (shared.open ? preloadWorkspaceInspector() : undefined),
    [shared.open],
  );
  const sheet = shared.open && mobile;
  const panel = useRef<HTMLElement | null>(null);
  usePhoneSheetFocus(sheet, panel, shared.request);
  if (!shared.open)
    return mobile || !count ? null : (
      <button
        type="button"
        className="needs-you-handle"
        aria-label={`Show Needs you: ${count}`}
        onClick={() => openNeedsYou()}
      >
        <AgentMark kind="needs" />
        <span>Needs you</span>
        <b>{count}</b>
      </button>
    );
  const tab = (
    <aside
      ref={panel}
      className={`needs-you-tab${mobile ? " is-sheet" : ""}`}
      aria-label="Needs you"
      {...(mobile ? { role: "dialog", "aria-modal": true, tabIndex: -1 } : {})}
    >
      <header className="needs-you-head">
        {mobile ? (
          <button
            type="button"
            className="needs-you-back"
            aria-label="Back"
            title="Back"
            data-layer-back
            onClick={closeNeedsYou}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        ) : null}
        <h2>Needs you</h2>
        {count ? <b className="needs-you-head-count">{count}</b> : null}
        {mobile ? null : (
          <button
            type="button"
            className="needs-you-icon needs-you-close"
            aria-label="Hide Needs you"
            title="Hide Needs you"
            onClick={closeNeedsYou}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      <NeedsYouList
        world={world}
        request={shared.request}
        openOutbox={shared.openOutbox}
        onChat={onChat}
        onOpenTerminal={onOpenTerminal}
      />
    </aside>
  );
  // On a phone the list is its own screen above the app.
  return mobile ? createPortal(tab, document.body) : tab;
}

/** An agent window (Chat about this) covers the phone list while open. */
const COVERING_WINDOW = ".world-managed-window";

/**
 * The phone list is a modal screen: the app behind it is inert and focus
 * moves to the requested item (or Back) on every opener request, returning
 * to the opener on close. While an agent window opened from the list covers
 * it, the app is live again; when that window closes, focus returns to
 * where it was in the list.
 */
function usePhoneSheetFocus(
  active: boolean,
  panel: { current: HTMLElement | null },
  request: NeedsYouState["request"],
) {
  const [covered, setCovered] = useState(false);
  const opener = useRef<Element | null>(null);
  const inside = useRef<HTMLElement | null>(null);
  // Who opened the list, so closing it returns there.
  if (active && opener.current === null)
    opener.current = document.activeElement;
  useEffect(() => {
    if (!active) return;
    const check = () =>
      setCovered(document.querySelector(COVERING_WINDOW) !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    const sheet = panel.current;
    if (!active || covered || !sheet) return;
    const made = [...document.body.children].filter(
      (element) => element !== sheet && !element.hasAttribute("inert"),
    );
    for (const element of made) element.setAttribute("inert", "");
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) inside.current = event.target;
    };
    sheet.addEventListener("focusin", remember);
    return () => {
      sheet.removeEventListener("focusin", remember);
      for (const element of made) element.removeAttribute("inert");
    };
  }, [active, covered, panel]);
  // Each opener request: the requested item's first control, else Back.
  useEffect(() => {
    if (!active || covered) return;
    const frame = requestAnimationFrame(() => {
      const sheet = panel.current;
      if (!sheet) return;
      const item = request.itemKey
        ? sheet.querySelector<HTMLElement>(".needs-you-item.is-focused")
        : null;
      // The item's reply (its first quick reply or its field), else its
      // first icon past the name (which opens its window).
      const target =
        item?.querySelector<HTMLElement>(
          ".needs-you-replies button:not([disabled]), .needs-you-field input, .agent-chat-ask-options button:not([disabled])",
        ) ??
        item?.querySelector<HTMLElement>(
          "header button:not([disabled]):not(.needs-you-name)",
        ) ??
        sheet.querySelector<HTMLElement>(".needs-you-back") ??
        sheet;
      target.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Only a new request moves focus, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, request.sequence]);
  // Back from a covering window: where focus was in the list.
  const wasCovered = useRef(false);
  useEffect(() => {
    if (wasCovered.current && !covered && active)
      (inside.current?.isConnected
        ? inside.current
        : panel.current?.querySelector<HTMLElement>(".needs-you-back")
      )?.focus();
    wasCovered.current = covered;
  }, [covered, active, panel]);
  // Closing returns focus to the opener, or to the counter that replaced it
  // (the phone's view picker re-renders while an agent window is open).
  useEffect(() => {
    if (active) return;
    const back = opener.current;
    opener.current = null;
    inside.current = null;
    if (back === null) return;
    const target =
      back instanceof HTMLElement && back.isConnected
        ? back
        : [
            ...document.querySelectorAll<HTMLElement>(".needs-you-counter"),
          ].find((counter) => counter.getClientRects().length > 0);
    target?.focus();
  }, [active]);
}

/** The pane's exact owner and agent session, as answers are attributed. */
export const needsYouOwnerKey = (leaf: WorldLeafObject) =>
  JSON.stringify([
    leaf.connectionId,
    leaf.generation,
    leaf.terminalId,
    leaf.agentSessionIdentity ?? leaf.agentSessionFingerprint ?? null,
  ]);

/** Where the list starts: an opener's item's page, else the page turned to. */
export function needsYouPage(
  items: readonly NeedsYouItem[],
  targetKey: string | undefined,
  page: { start: number; follow: boolean },
) {
  const targetIndex = targetKey
    ? items.findIndex(
        (item) =>
          item.key === targetKey ||
          (item.leaf && needsYouLeafKey(item.leaf.id) === targetKey),
      )
    : -1;
  const lastPage = Math.max(0, Math.ceil(items.length / ITEM_LIMIT) - 1);
  const start =
    page.follow && targetIndex >= 0
      ? Math.floor(targetIndex / ITEM_LIMIT) * ITEM_LIMIT
      : Math.min(page.start, lastPage * ITEM_LIMIT);
  return {
    start,
    focused: targetIndex >= 0 ? items[targetIndex]!.key : undefined,
  };
}

/**
 * Needs you's items, each a short message from its agent answered in place.
 * Every opener request (even for the same item again) turns to the page
 * holding its item; when that item leaves, the list stays on its page.
 */
export function NeedsYouList({
  world,
  request,
  openOutbox = null,
  now: shownNow,
  onChat,
  onOpenTerminal,
  asksStore = sharedAsksStore(),
  deskStore,
  attachmentUpload = askAttachmentUpload,
}: {
  world: World;
  request: NeedsYouState["request"];
  openOutbox?: (() => void) | null;
  /** A fixed clock for tests; the open list ticks its own. */
  now?: number;
  onChat(leafId: string): void;
  onOpenTerminal(leafId: string): void;
  /** The shared stores unless a test provides its own. */
  asksStore?: WorldAsksStore;
  deskStore?: WorldDeskStore;
  /** Where a question's answer stores its attached files. */
  attachmentUpload?: typeof askAttachmentUpload;
}) {
  const ticking = useNow(5_000);
  const now = shownNow ?? ticking;
  const asks = useWorldAsks(asksStore);
  const work = useReviewedWork(deskStore);
  const all = needsYouItems(world, asks, (leaf) => work.toReview(leaf, now));
  const [page, setPage] = useState({ start: 0, follow: true });
  const [pagedFor, setPagedFor] = useState(request.sequence);
  if (pagedFor !== request.sequence) {
    setPagedFor(request.sequence);
    setPage({ start: 0, follow: true });
  }
  const { start, focused } = needsYouPage(all, request.itemKey, page);
  // Once followed, the start stays put if the item leaves (answered).
  const startRef = useRef(start);
  if (page.follow && focused) startRef.current = start;
  const shownStart =
    page.follow && !focused && request.itemKey ? startRef.current : start;
  const items = all.slice(shownStart, shownStart + ITEM_LIMIT);
  const later = all.length - shownStart - items.length;
  // Answers given here, shown folded until the list closes.
  const [answered, setAnswered] = useState<
    readonly { key: string; name: string; text: string }[]
  >([]);
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focused) return;
    body.current
      ?.querySelector(`[data-needs-you-item="${CSS.escape(focused)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focused, request.sequence]);
  const turn = (to: number) => {
    setPage({ start: to, follow: false });
    body.current?.scrollTo?.({ top: 0 });
  };
  const shown = new Set(items.map((item) => item.key));
  const folded = answered.filter((entry) => !shown.has(entry.key));
  const count = needsYouCount(all);
  const deliveries = useAnswerDeliveryCounts();
  return (
    <div className="needs-you" ref={body}>
      {items.length ? (
        // The header's count shows it; this tells a screen reader.
        <p className="needs-you-count" role="status">
          {count
            ? `${count} waiting on you`
            : "Nothing blocked; finished work to review below."}
        </p>
      ) : (
        <p className="needs-you-none" role="status">
          <AgentMark kind="reviewed" label="Nothing waiting" />
          Nothing needs you.
        </p>
      )}
      {shownStart > 0 ? (
        <button
          type="button"
          className="needs-you-more"
          onClick={() => turn(Math.max(0, shownStart - ITEM_LIMIT))}
        >
          Show the {Math.min(ITEM_LIMIT, shownStart)} before
        </button>
      ) : null}
      {items.map((item) => (
        <NeedsYouMessage
          // A new owner or agent session on the same pane is a new item: no
          // receipt, question or pending answer carries over to it.
          key={`${item.key}|${item.leaf ? needsYouOwnerKey(item.leaf) : ""}`}
          item={item}
          now={now}
          focused={item.key === focused}
          stop={item.kind === "asks" ? null : work.stopOf(item.leaf)}
          onChat={onChat}
          onOpenTerminal={onOpenTerminal}
          onAnswer={async (text) => {
            if (item.kind !== "asks") return null;
            const problem = await asksStore.answer(item.ask.id, text);
            if (!problem)
              setAnswered((current) => [
                ...current,
                { key: item.key, name: itemName(item), text },
              ]);
            return problem;
          }}
          onAttach={
            item.kind === "asks"
              ? attachmentUpload(item.ask, item.leaf)
              : undefined
          }
          onDismiss={() =>
            item.kind === "asks"
              ? asksStore.dismiss(item.ask.id)
              : Promise.resolve(null)
          }
          onReviewed={(stop) =>
            item.kind === "done"
              ? work.mark(item.leaf, stop)
              : Promise.resolve(false)
          }
        />
      ))}
      {later > 0 ? (
        <button
          type="button"
          className="needs-you-more"
          onClick={() => turn(shownStart + ITEM_LIMIT)}
        >
          Show {Math.min(ITEM_LIMIT, later)} more of {later}
        </button>
      ) : null}
      {folded.map((entry) => (
        <article
          key={entry.key}
          className="needs-you-item is-answered"
          data-needs-you-item={entry.key}
        >
          <p>
            You answered <b>{entry.text}</b>. Waiting for {entry.name} to pick
            it up.
          </p>
        </article>
      ))}
      {openOutbox ? (
        <NeedsYouOutbox
          checks={deliveries.checks}
          waiting={deliveries.waiting}
          onOpen={openOutbox}
        />
      ) : null}
    </div>
  );
}

/**
 * Saved answers to check (Town's Outbox): a route to Town's Summary, which
 * holds the full cards. Shown only while answers need checking.
 */
export function NeedsYouOutbox({
  checks,
  waiting,
  onOpen,
}: {
  checks: number;
  waiting: number;
  onOpen(): void;
}) {
  return checks ? (
    <button
      type="button"
      className="needs-you-outbox"
      aria-label={`Outbox, ${checks} ${checks === 1 ? "answer" : "answers"} to check. Open summary.`}
      onClick={onOpen}
    >
      <span>
        ✉ Outbox · {checks} to check
        {waiting ? ` · ${waiting} waiting` : ""}
      </span>
      <span aria-hidden="true">›</span>
    </button>
  ) : null;
}
