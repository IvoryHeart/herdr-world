import { memo, useEffect, useRef, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import type { WorldSourcesSnapshot } from "../../../../shared/worldSources";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { openIntegrations } from "../../integrations";
import { PullRequestCard } from "../PullRequestCard";
import { BadgePopover } from "./DeskWorkBadge";
import type { TownCenterLot } from "./townCenter";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_WAREHOUSE_SLOTS,
  TOWN_WAREHOUSE_YARD_ROWS,
  townWarehouseCountParts,
  townWarehouseFoldAt,
  townWarehouseLabel,
  townWarehouseLot,
  townWarehouseName,
  townWarehouse,
  townWarehouseSignText,
  townWarehouseSlot,
  type TownWarehouse as Office,
  type TownWarehouseParcel,
} from "./townWarehouseModel";
import { useTownWarehouseSources } from "./townWarehouseFixture";
import type { TownRendererHandle } from "./townRenderer";
import { useOpenTownWork } from "./TownWorkLens";
import { useTownPlace } from "./townPlaces";
import { townCrateUrl, type TownCrateState } from "./townHarbourArt";
import "./townWarehouse.css";

/** A crate's painted art as a background. */
const crateArt = (state: TownCrateState) => {
  const url = townCrateUrl(state);
  return url ? `url("${url}")` : undefined;
};

/** How long a parcel takes to leave the yard (townWarehouse.css). */
export const TOWN_WAREHOUSE_LEAVE_MS = 1_400;

const openSourcesSettings = () => openIntegrations("source:github");

/** A parcel leaving the yard: carried off when merged, else just gone. */
type Leaving = {
  parcel: TownWarehouseParcel;
  slot: number;
  how: "loaded" | "gone";
};

/**
 * Parcels that left since the last read: merged ones are loaded for the next release, closed or
 * dropped ones simply go. Only parcels that stood in the yard animate; the
 * first read, and a source that closes, animate nothing.
 */
function useLeaving(office: Office, snapshot: WorldSourcesSnapshot) {
  const before =
    useRef<Map<string, { parcel: TownWarehouseParcel; slot: number }>>(null);
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
        how: merged.has(entry.parcel.key) ? "loaded" : "gone",
      }));
    if (!batch.length) return;
    setLeaving((list) => [...list, ...batch]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((list) => list.filter((entry) => !batch.includes(entry)));
    }, TOWN_WAREHOUSE_LEAVE_MS);
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
  count > TOWN_WAREHOUSE_SLOTS ? TOWN_WAREHOUSE_SLOTS - 1 : count;

/**
 * Re-reads the warehouse when a parcel's detail expires, so a ready
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
  if (office.status !== "open" || office.stale)
    return townWarehouseSignText(office);
  return townWarehouseCountParts(office.counts)
    .map((part) =>
      part.state === "ready" ? `${part.count} ready to merge` : part.text,
    )
    .join(", ");
}

/** The folded sign in words: what it holds, not how many. */
function foldedSpoken(office: Office) {
  if (office.status !== "open") return townWarehouseSignText(office);
  return office.stale
    ? "your pull requests, GitHub out of date"
    : "your pull requests";
}

const FOLDED_WAITING = {
  loading: "…",
  off: "closed",
  closed: "closed",
} as const;

/**
 * Town's warehouse (#760, moved to the harbour by #1028): your open pull requests as parcels in its
 * sorting yard beside the town center, ready to merge first, each opening the pull
 * request card the desk badge opens. Its sign counts them without hovering.
 * On a narrow (stacked) town it stands on the shore too, right of the
 * buildings, and a folded sign on the town center opens the same parcels
 * as a list within a phone's first view. Its sign,
 * and "All pull requests" in its lists, open Board's Work lens over Town
 * (#887): every pull request as the same kanban.
 */
export const TownWarehouse = memo(function TownWarehouse({
  layout,
  renderer,
}: {
  layout: TownLayout;
  /** Brings a focused parcel into view. */
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const snapshot = useTownWarehouseSources();
  // Read at every render: an expiring detail re-renders it (useExpiry).
  useExpiry(snapshot);
  const office = townWarehouse(snapshot, Date.now());
  const openWork = useOpenTownWork();
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
    const lot = townWarehouseLot(layout);
    const at = target.classList.contains("town-warehouse-fold")
      ? townWarehouseFoldAt(layout.center)
      : { x: (lot.x + lot.w / 2) * T, y: lot.yardY * T };
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
  const lot = townWarehouseLot(layout);
  const parcels = office.status === "open" ? office.parcels : [];
  const shown = parcels.slice(0, yardSlots(parcels.length));
  const pile = parcels.slice(shown.length);
  const quiet = office.status !== "open";
  const connect = office.status === "off" || office.status === "closed";
  // Work opens only once GitHub has answered; loading keeps the old sign.
  const work = office.status === "open" ? openWork : undefined;
  // The building opens what its sign does (#1170): Integrations while GitHub
  // is off, Work once it has answered; nothing while it is loading.
  useTownPlace("warehouse", connect ? openSourcesSettings : (work ?? null));
  return (
    <>
      <button
        type="button"
        className="town-warehouse-sign"
        data-town-place="warehouse"
        data-quiet={quiet || undefined}
        style={{ left: (lot.x + lot.w) * T - 12, top: lot.y * T + 34 }}
        aria-label={`Warehouse: ${spoken(office)}${work ? ". Open all pull requests" : ""}`}
        title={quiet && office.status === "closed" ? office.detail : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={reveal}
        onClick={(event) => {
          event.stopPropagation();
          if (connect) openSourcesSettings();
          else if (work) work();
          else
            yardRef.current
              ?.querySelector<HTMLElement>(".town-warehouse-parcel")
              ?.focus();
        }}
      >
        <span className="town-warehouse-sign-title" aria-hidden="true">
          WAREHOUSE
        </span>
        <SignCounts office={office} />
      </button>
      <div
        ref={yardRef}
        className="town-warehouse-yard"
        role="group"
        aria-label="Warehouse yard"
        style={{
          left: lot.x * T,
          top: lot.yardY * T,
          width: lot.w * T,
          height: TOWN_WAREHOUSE_YARD_ROWS * T,
        }}
      >
        {shown.map((parcel, index) => {
          const at = townWarehouseSlot(index);
          return (
            <button
              key={parcel.key}
              type="button"
              className="town-warehouse-parcel"
              data-state={parcel.state}
              style={{
                left: at.x,
                top: at.y,
                backgroundImage: crateArt(parcel.state),
              }}
              aria-label={`${townWarehouseLabel(parcel)}. Open pull request`}
              onPointerDown={(event) => event.stopPropagation()}
              onFocus={reveal}
              onClick={(event) => {
                event.stopPropagation();
                openCard(parcel.key, event.currentTarget);
              }}
            >
              <span className="town-warehouse-label" aria-hidden="true">
                <b>{townWarehouseName(parcel)}</b>
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
            at={townWarehouseSlot(shown.length)}
            onOpen={openCard}
            onOpenWork={openWork}
            onFocus={reveal}
          />
        ) : null}
        {leaving
          .filter((entry) => entry.slot < TOWN_WAREHOUSE_SLOTS)
          .map((entry) => {
            const at = townWarehouseSlot(entry.slot);
            return (
              <span
                key={`left:${entry.parcel.key}`}
                className="town-warehouse-parcel"
                data-state={entry.parcel.state}
                data-leaving={entry.how}
                style={{
                  left: at.x,
                  top: at.y,
                  backgroundImage: crateArt(entry.parcel.state),
                }}
                aria-hidden="true"
              />
            );
          })}
        <span className="town-warehouse-announce" role="status">
          {leaving
            .map(
              (entry) =>
                `${townWarehouseName(entry.parcel)} ${entry.how === "loaded" ? "merged" : "left the warehouse"}.`,
            )
            .join(" ")}
        </span>
      </div>
      {layout.formFactor === "narrow" ? (
        <FoldedSign
          center={layout.center}
          office={office}
          onOpen={openCard}
          onOpenWork={openWork}
          onFocus={reveal}
        />
      ) : null}
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
      <span className="town-warehouse-sign-counts" aria-hidden="true">
        {townWarehouseSignText(office)}
      </span>
    );
  return (
    <span className="town-warehouse-sign-counts" aria-hidden="true">
      {townWarehouseCountParts(office.counts).map((part) => (
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
  onOpenWork,
  onFocus,
}: {
  parcels: readonly TownWarehouseParcel[];
  at: { x: number; y: number };
  onOpen(key: string, anchor: HTMLElement | null): void;
  onOpenWork: (() => void) | null;
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
          className="town-warehouse-pile"
          style={{ left: at.x, top: at.y }}
          aria-label={`${parcels.length} more pull requests`}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          +{parcels.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-warehouse-popover"
        collisionPadding={8}
        aria-label="More pull requests"
      >
        <AllPullRequests
          onOpenWork={onOpenWork}
          onClose={() => setOpen(false)}
        />
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

/** Opens every pull request in the Work lens, closing the list first. */
function AllPullRequests({
  onOpenWork,
  onClose,
}: {
  onOpenWork: (() => void) | null;
  onClose(): void;
}) {
  if (!onOpenWork) return null;
  return (
    <button
      type="button"
      className="town-warehouse-all"
      onClick={() => {
        onClose();
        onOpenWork();
      }}
    >
      All pull requests
    </button>
  );
}

/** Parcels as rows: the folded sign's and the pile's list. */
function ParcelList({
  parcels,
  onOpen,
}: {
  parcels: readonly TownWarehouseParcel[];
  onOpen(key: string): void;
}) {
  return (
    <ul className="town-warehouse-list" aria-label="Pull requests">
      {parcels.map((parcel) => (
        <li key={parcel.key}>
          <button
            type="button"
            className="town-warehouse-row"
            aria-label={`${townWarehouseLabel(parcel)}. Open pull request`}
            onClick={() => onOpen(parcel.key)}
          >
            <span
              className="town-warehouse-icon"
              data-state={parcel.state}
              style={{ backgroundImage: crateArt(parcel.state) }}
              aria-hidden="true"
            />
            <span className="town-warehouse-row-name">
              {townWarehouseName(parcel)}
            </span>
            <span className="town-warehouse-row-why">
              {parcel.repo} · {parcel.why}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A crate, as the folded sign's mark. */
function CrateMark() {
  return (
    <span
      className="town-warehouse-mark"
      style={{ backgroundImage: crateArt("ready") }}
      aria-hidden="true"
    />
  );
}

/**
 * On a narrow town: a sign on the town center's right wing, inside a
 * phone's home view (townWarehouseFoldAt), opening the warehouse as a list
 * with its counts, or how to connect GitHub.
 */
function FoldedSign({
  center,
  office,
  onOpen,
  onOpenWork,
  onFocus,
}: {
  center: TownCenterLot;
  office: Office;
  onOpen(key: string, anchor: HTMLElement | null): void;
  onOpenWork: (() => void) | null;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const at = townWarehouseFoldAt(center);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="town-warehouse-fold"
          style={{ left: at.x, top: at.y }}
          aria-label={`Warehouse: ${foldedSpoken(office)}. Open`}
          title="Warehouse"
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          <CrateMark />
          {/* No counts here: the list inside has them, and the post office
              beside the center counts what Needs you (#1098). */}
          <span>
            {office.status === "open"
              ? office.stale
                ? "PRs · old"
                : "PRs"
              : FOLDED_WAITING[office.status]}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-warehouse-popover"
        collisionPadding={8}
        aria-label="Warehouse"
      >
        <header className="town-warehouse-popover-title">
          <CrateMark />
          <span>WAREHOUSE</span>
        </header>
        <p className="town-warehouse-popover-counts">
          {townWarehouseSignText(office)}
        </p>
        {office.status === "open" ? (
          <AllPullRequests
            onOpenWork={onOpenWork}
            onClose={() => setOpen(false)}
          />
        ) : null}
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
            <p className="town-warehouse-popover-note">
              No open pull requests.
            </p>
          )
        ) : office.status === "loading" ? null : (
          <>
            {office.status === "closed" ? (
              <p className="town-warehouse-popover-note">{office.detail}</p>
            ) : null}
            <button
              type="button"
              className="town-warehouse-setup"
              onClick={() => {
                setOpen(false);
                openSourcesSettings();
              }}
            >
              Connect GitHub
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
