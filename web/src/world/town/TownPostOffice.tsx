import { memo, useEffect, useRef, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import type { WorldSourcesSnapshot } from "../../../../shared/worldSources";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { WORLD_SOURCES_SETTINGS_EVENT } from "../../workspaceResource";
import { PullRequestCard } from "../PullRequestCard";
import { BadgePopover } from "./DeskWorkBadge";
import type { TownCenterLot } from "./townCenter";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_POST_SLOTS,
  TOWN_POST_YARD_ROWS,
  townPostCountParts,
  townPostFoldAt,
  townPostLabel,
  townPostLot,
  townPostName,
  townPostOffice,
  townPostSignText,
  townPostSlot,
  type TownPostOffice as Office,
  type TownPostParcel,
} from "./townPost";
import { useTownPostSources } from "./townPostFixture";
import type { TownRendererHandle } from "./townRenderer";
import "./townPost.css";

/** How long a parcel takes to leave the yard (townPost.css). */
export const TOWN_POST_LEAVE_MS = 1_400;

const openSourcesSettings = () =>
  window.dispatchEvent(new Event(WORLD_SOURCES_SETTINGS_EVENT));

/** A parcel leaving the yard: carried off when merged, else just gone. */
type Leaving = {
  parcel: TownPostParcel;
  slot: number;
  how: "posted" | "gone";
};

/**
 * Parcels that left since the last read: merged ones are posted, closed or
 * dropped ones simply go. Only parcels that stood in the yard animate; the
 * first read, and a source that closes, animate nothing.
 */
function useLeaving(office: Office, snapshot: WorldSourcesSnapshot) {
  const before =
    useRef<Map<string, { parcel: TownPostParcel; slot: number }>>(null);
  const timers = useRef(new Set<number>());
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  useEffect(() => {
    if (office.status !== "open") {
      before.current = null;
      return;
    }
    const prev = before.current;
    const yard = yardSlots(office.parcels.length);
    before.current = new Map(
      office.parcels
        .slice(0, yard)
        .map((parcel, slot) => [parcel.key, { parcel, slot }]),
    );
    if (!prev) return;
    const open = new Set(office.parcels.map((parcel) => parcel.key));
    const merged = new Set(
      snapshot.items
        .filter((item) => item.lane === "merged")
        .map((item) => item.key),
    );
    const batch: Leaving[] = [...prev.values()]
      .filter(({ parcel }) => !open.has(parcel.key))
      .map((entry) => ({
        ...entry,
        how: merged.has(entry.parcel.key) ? "posted" : "gone",
      }));
    if (!batch.length) return;
    setLeaving((list) => [...list, ...batch]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((list) => list.filter((entry) => !batch.includes(entry)));
    }, TOWN_POST_LEAVE_MS);
    timers.current.add(timer);
  }, [office, snapshot]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
    };
  }, []);
  return leaving;
}

/** How many parcels stand in the yard; the rest make the "+N" pile. */
const yardSlots = (count: number) =>
  count > TOWN_POST_SLOTS ? TOWN_POST_SLOTS - 1 : count;

/**
 * Re-reads the post office when a parcel's detail expires, so a ready
 * parcel never outlives the fresh read that made it ready.
 */
function useExpiry(snapshot: WorldSourcesSnapshot) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    let next = Infinity;
    for (const item of snapshot.items) {
      const expires = item.prObservation?.expiresAt;
      if (typeof expires === "number" && expires > now)
        next = Math.min(next, expires);
    }
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(
      () => setTick((value) => value + 1),
      Math.min(next - now + 20, 2 ** 31 - 1),
    );
    return () => window.clearTimeout(timer);
  }, [snapshot, tick]);
}

/** The counts in words, for names and the folded sign. */
function spoken(office: Office) {
  if (office.status !== "open" || office.stale) return townPostSignText(office);
  return townPostCountParts(office.counts)
    .map((part) =>
      part.state === "ready" ? `${part.count} ready to merge` : part.text,
    )
    .join(", ");
}

const FOLDED_WAITING = {
  loading: "…",
  off: "closed",
  closed: "closed",
} as const;

/**
 * Town's post office (#760): your open pull requests as parcels in its
 * sorting yard beside the town center, ready to merge first, each opening the pull
 * request card the desk badge opens. Its sign counts them without hovering.
 * On a narrow (stacked) town it folds to a sign on the town center that
 * opens the same parcels as a list, as the city billboard folds.
 */
export const TownPostOffice = memo(function TownPostOffice({
  layout,
  renderer,
}: {
  layout: TownLayout;
  /** Brings a focused parcel into view. */
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const snapshot = useTownPostSources();
  // Read at every render: an expiring detail re-renders it (useExpiry).
  useExpiry(snapshot);
  const office = townPostOffice(snapshot, Date.now());
  const leaving = useLeaving(office, snapshot);
  const [cardKey, setCardKey] = useState<string | null>(null);
  const cardAnchor = useRef<HTMLElement | null>(null);
  const yardRef = useRef<HTMLDivElement | null>(null);
  const item = cardKey
    ? snapshot.items.find((entry) => entry.key === cardKey)
    : undefined;
  // A pull request GitHub no longer lists closes its card for good.
  useEffect(() => {
    if (cardKey && !item) setCardKey(null);
  }, [cardKey, item]);
  const openCard = (key: string, anchor: HTMLElement | null) => {
    cardAnchor.current = anchor;
    setCardKey(key);
  };
  /** Keyboard focus on an off-screen parcel or sign pans it into view. */
  const reveal = (event: FocusEvent<HTMLElement>) => {
    const handle = renderer.current;
    const target = event.currentTarget;
    if (!handle || !focusVisible(target)) return;
    const box = target.getBoundingClientRect();
    const { width, height } = handle.camera.viewport;
    const margin = 80;
    if (
      box.left > margin &&
      box.top > margin &&
      box.right < width - margin &&
      box.bottom < height - margin
    )
      return;
    const lot = townPostLot(layout);
    const at = lot
      ? { x: (lot.x + lot.w / 2) * T, y: lot.yardY * T }
      : townPostFoldAt(layout.center);
    handle.camera.flyTo(at.x, at.y, handle.camera.z, 0.4);
    handle.invalidate("focus");
  };
  const card =
    cardKey && item
      ? createPortal(
          <BadgePopover
            anchor={cardAnchor}
            label={`Pull request ${item.ref}`}
            onClose={() => setCardKey(null)}
          >
            <PullRequestCard item={item} compact />
          </BadgePopover>,
          document.body,
        )
      : null;
  const lot = townPostLot(layout);
  if (!lot)
    return (
      <>
        <FoldedSign
          center={layout.center}
          office={office}
          onOpen={openCard}
          onFocus={reveal}
        />
        {card}
      </>
    );
  const parcels = office.status === "open" ? office.parcels : [];
  const shown = parcels.slice(0, yardSlots(parcels.length));
  const pile = parcels.slice(shown.length);
  const quiet = office.status !== "open";
  return (
    <>
      <button
        type="button"
        className="town-post-sign"
        data-quiet={quiet || undefined}
        style={{ left: (lot.x + lot.w / 2) * T, top: lot.y * T + 34 }}
        aria-label={`Post office: ${spoken(office)}`}
        title={quiet && office.status === "closed" ? office.detail : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={reveal}
        onClick={(event) => {
          event.stopPropagation();
          if (office.status === "off" || office.status === "closed")
            openSourcesSettings();
          else
            yardRef.current
              ?.querySelector<HTMLElement>(".town-post-parcel")
              ?.focus();
        }}
      >
        <span className="town-post-sign-title" aria-hidden="true">
          POST OFFICE
        </span>
        <SignCounts office={office} />
      </button>
      <div
        ref={yardRef}
        className="town-post-yard"
        role="group"
        aria-label="Post office yard"
        style={{
          left: lot.x * T,
          top: lot.yardY * T,
          width: lot.w * T,
          height: TOWN_POST_YARD_ROWS * T,
        }}
      >
        {shown.map((parcel, index) => {
          const at = townPostSlot(index);
          return (
            <button
              key={parcel.key}
              type="button"
              className="town-post-parcel"
              data-state={parcel.state}
              style={{ left: at.x, top: at.y }}
              aria-label={`${townPostLabel(parcel)}. Open pull request`}
              onPointerDown={(event) => event.stopPropagation()}
              onFocus={reveal}
              onClick={(event) => {
                event.stopPropagation();
                openCard(parcel.key, event.currentTarget);
              }}
            >
              <span className="town-post-label" aria-hidden="true">
                <b>{townPostName(parcel)}</b>
                <span>
                  {parcel.repo} · {parcel.why}
                </span>
              </span>
            </button>
          );
        })}
        {pile.length ? (
          <Pile
            parcels={pile}
            at={townPostSlot(shown.length)}
            onOpen={openCard}
            onFocus={reveal}
          />
        ) : null}
        {leaving
          .filter((entry) => entry.slot < TOWN_POST_SLOTS)
          .map((entry) => {
            const at = townPostSlot(entry.slot);
            return (
              <span
                key={`left:${entry.parcel.key}`}
                className="town-post-parcel"
                data-state={entry.parcel.state}
                data-leaving={entry.how}
                style={{ left: at.x, top: at.y }}
                aria-hidden="true"
              />
            );
          })}
        <span className="town-post-announce" role="status">
          {leaving
            .map(
              (entry) =>
                `${townPostName(entry.parcel)} ${entry.how === "posted" ? "merged" : "left the post office"}.`,
            )
            .join(" ")}
        </span>
      </div>
      {card}
    </>
  );
});

function focusVisible(element: HTMLElement) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** The sign's second line: counts by state, or what stands in for them. */
function SignCounts({ office }: { office: Office }) {
  if (office.status !== "open" || office.stale)
    return (
      <span className="town-post-sign-counts" aria-hidden="true">
        {townPostSignText(office)}
      </span>
    );
  return (
    <span className="town-post-sign-counts" aria-hidden="true">
      {townPostCountParts(office.counts).map((part) => (
        <span key={part.state} data-state={part.state}>
          <i aria-hidden="true" />
          {part.text}
        </span>
      ))}
    </span>
  );
}

/** Parcels beyond the yard: "+N", opening them as a list. */
function Pile({
  parcels,
  at,
  onOpen,
  onFocus,
}: {
  parcels: readonly TownPostParcel[];
  at: { x: number; y: number };
  onOpen(key: string, anchor: HTMLElement | null): void;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="town-post-pile"
          style={{ left: at.x, top: at.y }}
          aria-label={`${parcels.length} more pull requests`}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          +{parcels.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-post-popover"
        collisionPadding={8}
        aria-label="More pull requests"
      >
        <ParcelList
          parcels={parcels}
          onOpen={(key) => {
            setOpen(false);
            onOpen(key, trigger.current);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Parcels as rows: the folded sign's and the pile's list. */
function ParcelList({
  parcels,
  onOpen,
}: {
  parcels: readonly TownPostParcel[];
  onOpen(key: string): void;
}) {
  return (
    <ul className="town-post-list" aria-label="Pull requests">
      {parcels.map((parcel) => (
        <li key={parcel.key}>
          <button
            type="button"
            className="town-post-row"
            aria-label={`${townPostLabel(parcel)}. Open pull request`}
            onClick={() => onOpen(parcel.key)}
          >
            <span
              className="town-post-icon"
              data-state={parcel.state}
              aria-hidden="true"
            />
            <span className="town-post-row-name">{townPostName(parcel)}</span>
            <span className="town-post-row-why">
              {parcel.repo} · {parcel.why}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The red pillar box painted by the house door, as the folded sign's mark. */
function PostBox() {
  return <span className="town-post-box" aria-hidden="true" />;
}

/**
 * On a narrow town: a sign on the town center's right wing, inside a phone's
 * home view (townPostFoldAt), opening the post office as a list, or how to
 * connect GitHub.
 */
function FoldedSign({
  center,
  office,
  onOpen,
  onFocus,
}: {
  center: TownCenterLot;
  office: Office;
  onOpen(key: string, anchor: HTMLElement | null): void;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const at = townPostFoldAt(center);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="town-post-fold"
          style={{ left: at.x, top: at.y }}
          aria-label={`Post office: ${spoken(office)}. Open`}
          title="Post office"
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          <PostBox />
          {office.status === "open" && !office.stale ? (
            <span className="town-post-fold-counts">
              {(["ready", "failing", "waiting"] as const).map((state) => (
                <b key={state} data-state={state}>
                  {office.counts[state]}
                </b>
              ))}
            </span>
          ) : (
            <span>
              {office.status === "open" ? "old" : FOLDED_WAITING[office.status]}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-post-popover"
        collisionPadding={8}
        aria-label="Post office"
      >
        <header className="town-post-popover-title">
          <PostBox />
          <span>POST OFFICE</span>
        </header>
        <p className="town-post-popover-counts">{townPostSignText(office)}</p>
        {office.status === "open" ? (
          office.parcels.length ? (
            <ParcelList
              parcels={office.parcels}
              onOpen={(key) => {
                setOpen(false);
                onOpen(key, trigger.current);
              }}
            />
          ) : (
            <p className="town-post-popover-note">No open pull requests.</p>
          )
        ) : office.status === "loading" ? null : (
          <>
            {office.status === "closed" ? (
              <p className="town-post-popover-note">{office.detail}</p>
            ) : null}
            <button
              type="button"
              className="town-post-setup"
              onClick={() => {
                setOpen(false);
                openSourcesSettings();
              }}
            >
              Set up GitHub in Sources
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
