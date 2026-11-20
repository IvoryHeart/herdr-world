import { memo, useEffect, useRef, useState, type FocusEvent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { ShipRow } from "../shipyard/ShipyardPipeline";
import {
  runningCount,
  shipyardBeaconWords,
  shipyardDate,
  shipyardSignText,
  shipyardView,
  type ShipyardShip,
  type ShipyardView,
} from "../shipyard/shipyardModel";
import { useShipyard } from "../shipyard/shipyardStore";
import {
  TOWN_HARBOUR_BASIN_ROWS,
  TOWN_HARBOUR_BERTHS,
  TOWN_HARBOUR_CRATES,
  TOWN_HARBOUR_LAMP,
  TOWN_HARBOUR_QUAY_ROWS,
  townHarbourBerth,
  townHarbourCrate,
  townHarbourFoldAt,
  townHarbourLot,
} from "./townHarbour";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import type { TownRendererHandle } from "./townRenderer";
import { useOpenTownWork } from "./TownWorkLens";
import "./townHarbour.css";

/** How long a newly published release takes to sail in (townHarbour.css). */
export const TOWN_HARBOUR_ARRIVE_MS = 1_600;

type Open = Extract<ShipyardView, { status: "open" }>;

/**
 * Releases that appeared since the last read sail into their berth. The
 * first read, and a change of repository, sail nothing in.
 */
function useArrivals(view: ShipyardView) {
  const seen = useRef<{ repo: string; ids: Set<number> } | null>(null);
  const timers = useRef(new Set<number>());
  const [arriving, setArriving] = useState<ReadonlySet<number>>(new Set());
  const repo = view.status === "open" ? view.repo : null;
  const key =
    view.status === "open"
      ? view.ships
          .slice(0, TOWN_HARBOUR_BERTHS)
          .map((ship) => ship.release.id)
          .join(",")
      : "";
  useEffect(() => {
    if (!repo) return;
    const ids = key ? key.split(",").map(Number) : [];
    const prev = seen.current;
    seen.current = { repo, ids: new Set(ids) };
    if (!prev || prev.repo !== repo) return;
    const fresh = ids.filter((id) => !prev.ids.has(id));
    if (!fresh.length) return;
    setArriving((set) => new Set([...set, ...fresh]));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setArriving((set) => {
        const next = new Set(set);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, TOWN_HARBOUR_ARRIVE_MS);
    timers.current.add(timer);
  }, [repo, key]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
    };
  }, []);
  return arriving;
}

/** The ship's name in words, for its button and the folded sign. */
function shipWords(ship: ShipyardShip, now: number) {
  const { release } = ship;
  const parts = [
    release.tag,
    release.channel === "stable" ? "stable" : "prerelease",
    shipyardDate(release.publishedAt, now),
  ];
  if (ship.baseline) parts.push("latest");
  if (ship.running.length)
    parts.push(
      `running on port${ship.running.length === 1 ? "" : "s"} ${ship.running
        .map((instance) => instance.port)
        .join(", ")}`,
    );
  return parts.join(", ");
}

/** The lighthouse lamp's tone: main's checks, unknown until GitHub answers. */
const beaconOf = (view: ShipyardView) =>
  view.status === "open" ? view.main.beacon : "unknown";

/**
 * Town's harbour (#1028): the Shipyard's release pipeline beside the town
 * center. Its lighthouse lamp is main's checks, the crates on its quay are
 * the changes merged and waiting for the next release, and its ships are
 * the latest releases, newest by the crane, each flying a green pennant
 * while a World here runs it. A ship opens its release; the sign and the
 * crates open the Work lens on Releases, the whole pipeline. A narrow town
 * folds it to a sign on the town center's left wing.
 */
export const TownShipyard = memo(function TownShipyard({
  layout,
  renderer,
}: {
  layout: TownLayout;
  /** Brings a focused ship or sign into view. */
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const state = useShipyard();
  const view = shipyardView(state);
  const openWork = useOpenTownWork();
  const releases = openWork ? () => openWork("releases") : null;
  const arriving = useArrivals(view);
  const lot = townHarbourLot(layout);
  const fold = townHarbourFoldAt(layout.center, T);
  /** Keyboard focus on an off-screen ship or sign pans it into view. */
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
    const at = lot ? { x: (lot.x + lot.w / 2) * T, y: lot.quayY * T } : fold;
    handle.camera.flyTo(at.x, at.y, handle.camera.z, 0.4);
    handle.invalidate("focus");
  };
  const signText = shipyardSignText(view);
  const label = `Shipyard: ${signText}${releases ? ". Open releases" : ""}`;
  if (!lot)
    return (
      <button
        type="button"
        className="town-harbour-fold"
        data-quiet={view.status !== "open" || undefined}
        style={{ left: fold.x, top: fold.y }}
        aria-label={label}
        title="Shipyard"
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={reveal}
        onClick={(event) => {
          event.stopPropagation();
          releases?.();
        }}
      >
        <span
          className="town-harbour-beacon"
          data-tone={beaconOf(view)}
          aria-hidden="true"
        />
        <span className="town-harbour-icon" aria-hidden="true" />
        <span aria-hidden="true">{foldedText(view)}</span>
      </button>
    );
  const open = view.status === "open" ? view : null;
  const now = Date.now();
  const ships = open ? open.ships.slice(0, TOWN_HARBOUR_BERTHS) : [];
  return (
    <div
      className="town-harbour"
      data-stale={open?.stale || undefined}
      data-quiet={!open || undefined}
      style={{
        left: lot.x * T,
        top: lot.y * T,
        width: lot.w * T,
        height: (TOWN_HARBOUR_BASIN_ROWS + TOWN_HARBOUR_QUAY_ROWS) * T,
      }}
    >
      <span
        className="town-harbour-lamp"
        data-tone={beaconOf(view)}
        style={{ left: TOWN_HARBOUR_LAMP.x, top: TOWN_HARBOUR_LAMP.y }}
        role="img"
        aria-label={
          open
            ? `Lighthouse: ${open.main.words}`
            : `Lighthouse: ${shipyardBeaconWords("unknown")}`
        }
      />
      <button
        type="button"
        className="town-harbour-sign"
        style={{ left: (lot.w * T) / 2 }}
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={reveal}
        onClick={(event) => {
          event.stopPropagation();
          releases?.();
        }}
      >
        <span className="town-harbour-sign-title" aria-hidden="true">
          SHIPYARD
        </span>
        <span className="town-harbour-sign-text" aria-hidden="true">
          {signText}
        </span>
      </button>
      <div className="town-harbour-basin" role="group" aria-label="Releases">
        {ships.map((ship, index) => (
          <Ship
            key={ship.release.id}
            ship={ship}
            index={index}
            now={now}
            arriving={arriving.has(ship.release.id)}
            onOpenWork={releases}
            onFocus={reveal}
          />
        ))}
      </div>
      {open ? (
        <Cargo view={open} onOpenWork={releases} onFocus={reveal} />
      ) : null}
      <span className="town-harbour-announce" role="status">
        {open
          ? open.ships
              .filter((ship) => arriving.has(ship.release.id))
              .map((ship) => `${ship.release.tag} released.`)
              .join(" ")
          : ""}
      </span>
    </div>
  );
});

function focusVisible(element: HTMLElement) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** The folded sign's words: the latest release and what waits for the next. */
function foldedText(view: ShipyardView) {
  if (view.status === "loading") return "…";
  if (view.status !== "open") return "closed";
  if (view.stale) return "old";
  const latest = view.ships[0]?.release.tag ?? "none";
  return `${latest} · ${view.cargo.count}`;
}

/** One release moored at its berth, opening its card. */
function Ship({
  ship,
  index,
  now,
  arriving,
  onOpenWork,
  onFocus,
}: {
  ship: ShipyardShip;
  index: number;
  now: number;
  arriving: boolean;
  onOpenWork: (() => void) | null;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const at = townHarbourBerth(index);
  const flying = ship.running.some((instance) => instance.state === "fresh");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="town-harbour-ship"
          data-channel={ship.release.channel}
          data-running={flying || undefined}
          data-arriving={arriving || undefined}
          style={{ left: at.x, top: at.y }}
          aria-label={`Release ${shipWords(ship, now)}. Open`}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          <span className="town-harbour-sail" aria-hidden="true" />
          <span className="town-harbour-hull" aria-hidden="true">
            {ship.release.tag}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-harbour-popover"
        collisionPadding={8}
        aria-label={`Release ${ship.release.tag}`}
      >
        <header className="town-harbour-popover-title">
          <span className="town-harbour-icon" aria-hidden="true" />
          <span>RELEASE</span>
        </header>
        <ul className="shipyard-ships">
          <ShipRow ship={ship} now={now} />
        </ul>
        {ship.running.length ? (
          <p className="town-harbour-popover-note">
            {runningCount(ship.running)} on this computer.
          </p>
        ) : null}
        <AllReleases onOpenWork={onOpenWork} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Opens the Work lens on Releases, closing the card first. */
function AllReleases({
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
      className="town-harbour-all"
      onClick={() => {
        onClose();
        onOpenWork();
      }}
    >
      All releases
    </button>
  );
}

/**
 * The quay's cargo: one crate per pull request waiting for the next
 * release, "+N" past the stack, "?" when the count is unknown. One button
 * opens the waiting list in the Work lens.
 */
function Cargo({
  view,
  onOpenWork,
  onFocus,
}: {
  view: Open;
  onOpenWork: (() => void) | null;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const { cargo } = view;
  // Crates are merged pull requests, as the sign counts; direct commits
  // are listed in the Releases tab.
  const proven = cargo.pullRequests.length;
  const partial = cargo.count.includes("+");
  const stacked =
    proven > TOWN_HARBOUR_CRATES || (partial && proven >= TOWN_HARBOUR_CRATES)
      ? TOWN_HARBOUR_CRATES - 1
      : proven;
  const tally =
    cargo.count === "unknown"
      ? "?"
      : proven > stacked
        ? `+${proven - stacked}${partial ? "+" : ""}`
        : partial
          ? "+"
          : null;
  return (
    <button
      type="button"
      className="town-harbour-cargo"
      style={{ top: TOWN_HARBOUR_BASIN_ROWS * T }}
      aria-label={`Waiting to ship: ${cargo.count}${cargo.since ? ` ${cargo.since}` : ""}${onOpenWork ? ". Open releases" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={onFocus}
      onClick={(event) => {
        event.stopPropagation();
        onOpenWork?.();
      }}
    >
      {Array.from({ length: stacked }, (_, index) => {
        const at = townHarbourCrate(index);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: crates are slots
            key={index}
            className="town-harbour-crate"
            style={{ left: at.x, top: at.y }}
            aria-hidden="true"
          />
        );
      })}
      {tally ? (
        <span
          className="town-harbour-tally"
          style={tallyAt(townHarbourCrate(stacked))}
          aria-hidden="true"
        >
          {tally}
        </span>
      ) : null}
    </button>
  );
}

const tallyAt = ({ x, y }: { x: number; y: number }) => ({ left: x, top: y });
