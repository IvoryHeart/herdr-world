import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
} from "react";
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
import {
  shipyardLanes,
  shipyardStore,
  useShipyard,
  type ShipyardState,
} from "../shipyard/shipyardStore";
import {
  TOWN_HARBOUR_BERTHS,
  TOWN_PIER_BOLLARDS,
  TOWN_PIER_SLIPWAY,
  townBerthAt,
  townHarbourLot,
  townHarbourPlaced,
  townHarbourSignRow,
  townLanePierAt,
  townLaneSignAt,
  townLanesShown,
  townLighthouseAt,
  townProjectColor,
  type TownHarbourLot,
} from "./townHarbour";
import {
  TOWN_PIER_ART,
  townFlagUrl,
  townHullUrl,
  townLighthouseUrl,
  townPierUrl,
  townShipUrl,
} from "./townHarbourArt";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import type { TownRendererHandle } from "./townRenderer";
import { useOpenTownWork } from "./TownWorkLens";
import "./townHarbour.css";

/** How long a newly published release takes to sail in (townHarbour.css). */
export const TOWN_HARBOUR_ARRIVE_MS = 1_600;

type Reveal = (event: FocusEvent<HTMLElement>) => void;
/** Show a project's pipeline in the Work lens's Releases tab. */
type OpenProject = ((repo: string) => void) | null;

/** One project's lane: its repository, colour and pipeline. */
type Lane = { repo: string; color: string; view: ShipyardView };

/**
 * The open projects with releases (#1226), in the catalog's order, and a
 * repository typed in the Releases tab while chosen, each with its colour
 * and its own pipeline read from the shared store (#1148). A project gets a
 * lane once a read of its GitHub releases (kept while a later read fails,
 * then shown out of date) lists at least one published release. One not
 * read yet, with no release, or whose GitHub source is off or signed out
 * gets none: it stays in the Releases tab, which says why.
 */
export function townShipyardLanes(state: ShipyardState, now: number): Lane[] {
  if (!state.catalog) return [];
  const lanes: Lane[] = [];
  for (const repo of shipyardLanes(state.catalog, state.manual)) {
    const snapshot = state.snapshots[repo];
    if (!snapshot) continue;
    // A lane whose own read failed keeps its last answer, out of date.
    const error = state.error ?? state.laneErrors[repo] ?? null;
    const view = shipyardView({ ...state, repo, snapshot, error }, now);
    if (view.status !== "open" || !view.ships.length) continue;
    lanes.push({ repo, color: townProjectColor(lanes.length), view });
  }
  return lanes;
}

/** "widgets" for "example-org/widgets": the lane's board. */
const shortName = (repo: string) => repo.slice(repo.indexOf("/") + 1);

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

/** The ship's name in words, for its button. */
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
 * The harbour's sign: how many projects, and how many need a look. Before
 * the catalog answers, or with no project, the chosen pipeline's words.
 */
export function townHarbourSignText(
  lanes: readonly Lane[],
  chosen: ShipyardView,
) {
  if (!lanes.length) return shipyardSignText(chosen);
  const open = lanes.filter((lane) => lane.view.status === "open");
  const failing = open.filter(
    (lane) => lane.view.status === "open" && lane.view.main.beacon === "fail",
  ).length;
  const old = open.filter(
    (lane) => lane.view.status === "open" && lane.view.stale,
  ).length;
  const parts = [`${lanes.length} project${lanes.length === 1 ? "" : "s"}`];
  if (failing) parts.push(`${failing} main failing`);
  if (old) parts.push(`${old} out of date`);
  return parts.join(" · ");
}

/**
 * Town's harbour (#1028): the Shipyard at the town's right-most edge, on
 * open sea. Every project with releases has its own shipping lane, in its
 * own colour, and no other lane or pier is drawn (#1148): a
 * flag and name board at the pier's root, the next release being built on
 * the slipway with the count of merged changes waiting for it, the latest
 * releases moored along the pier (a green pennant while a World here runs
 * one), and main's checks in the lighthouse at the pier's head, past the
 * last berth and drawn above every ship (#1148). A board, a
 * hull or a ship's "All releases" opens that project in the Work lens's
 * Releases tab; a ship opens its release's card. Open pull requests are the
 * warehouse's (TownWarehouse.tsx). A narrow (phone) town has the same
 * harbour right of its stacked buildings and civic row, reached by panning
 * or zooming (#1351).
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
  const now = Date.now();
  const chosen = shipyardView(state, now);
  const lanes = townShipyardLanes(state, now);
  const openWork = useOpenTownWork();
  const openProject: OpenProject = openWork
    ? (repo) => {
        void shipyardStore.choose(repo);
        openWork("releases");
      }
    : null;
  // The drawn lanes (a "+N" lane included) and the sign sit vertically
  // centred on the harbour's side of Town, not from its top.
  const shown = townLanesShown(townHarbourLot(layout), lanes.length);
  const rest = lanes.slice(shown);
  const lot = townHarbourPlaced(
    townHarbourLot(layout),
    shown + (rest.length ? 1 : 0),
  );
  /** Keyboard focus on an off-screen ship or sign pans it into view. */
  const reveal: Reveal = (event) => {
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
    const own = target.closest<HTMLElement>("[data-at-x]");
    if (!own) return;
    const at = { x: Number(own.dataset.atX), y: Number(own.dataset.atY) };
    handle.camera.flyTo(at.x, at.y, handle.camera.z, 0.4);
    handle.invalidate("focus");
  };
  const signText = townHarbourSignText(lanes, chosen);
  const label = `Shipyard: ${signText}${openWork ? ". Open releases" : ""}`;
  const signAt = { x: lot.streetEnd * T + 4, y: townHarbourSignRow(lot) * T };
  return (
    <>
      <div
        className="town-harbour"
        data-quiet={!lanes.length || undefined}
        role="group"
        aria-label="Shipyard"
      >
        <button
          type="button"
          className="town-harbour-sign"
          style={{ left: signAt.x, top: signAt.y }}
          data-at-x={signAt.x}
          data-at-y={signAt.y + 40}
          aria-label={label}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={reveal}
          onClick={(event) => {
            event.stopPropagation();
            openWork?.("releases");
          }}
        >
          <span className="town-harbour-sign-title" aria-hidden="true">
            SHIPYARD
          </span>
          <span className="town-harbour-sign-text" aria-hidden="true">
            {signText}
          </span>
        </button>
        {lanes.slice(0, shown).map((lane, index) => (
          <LaneView
            key={lane.repo}
            lot={lot}
            index={index}
            lane={lane}
            now={now}
            onOpenProject={openProject}
            onFocus={reveal}
          />
        ))}
        {rest.length ? (
          <MoreLanes
            lot={lot}
            index={shown}
            lanes={rest}
            onOpenProject={openProject}
            onFocus={reveal}
          />
        ) : null}
      </div>
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

/** The waiting count on the slipway's board: "4", "200+", "?". */
function tallyOf(view: Extract<ShipyardView, { status: "open" }>) {
  const { count } = view.cargo;
  const match = /^(\d+\+?) waiting$/.exec(count);
  return match ? match[1]! : count === "unknown" ? "?" : null;
}

/** One project's shipping lane. */
function LaneView({
  lot,
  index,
  lane,
  now,
  onOpenProject,
  onFocus,
}: {
  lot: TownHarbourLot;
  index: number;
  lane: Lane;
  now: number;
  onOpenProject: OpenProject;
  onFocus: Reveal;
}) {
  const { repo, color, view } = lane;
  const arriving = useArrivals(view);
  const pier = townLanePierAt(lot, index);
  const sign = townLaneSignAt(lot, index);
  const open = view.status === "open" ? view : null;
  const ships = open ? open.ships.slice(0, TOWN_HARBOUR_BERTHS) : [];
  const tally = open ? tallyOf(open) : null;
  const hull = townBerthAt(lot, index, 0);
  const style = { "--lane": color } as CSSProperties;
  const words = shipyardSignText(view);
  const light = townLighthouseAt(lot, index);
  const openThis = onOpenProject ? () => onOpenProject(repo) : null;
  return (
    <div
      className="town-harbour-lane"
      role="group"
      aria-label={`Shipping lane ${repo}`}
      data-quiet={!open || undefined}
      data-stale={open?.stale || undefined}
      data-at-x={pier.x + pier.w / 2}
      data-at-y={pier.y}
      style={style}
    >
      <button
        type="button"
        className="town-harbour-board"
        style={{ left: sign.x, top: sign.y }}
        aria-label={`${repo}: ${words}${openThis ? ". Open releases" : ""}`}
        title={repo}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={onFocus}
        onClick={(event) => {
          event.stopPropagation();
          openThis?.();
        }}
      >
        <span
          className="town-harbour-flag"
          style={{ backgroundImage: urlOf(townFlagUrl(color, "flag")) }}
          aria-hidden="true"
        />
        <span className="town-harbour-board-name" aria-hidden="true">
          {shortName(repo)}
        </span>
      </button>
      <Pier pier={pier} />
      <span
        className="town-harbour-lighthouse"
        style={{
          left: light.x,
          top: light.y,
          backgroundImage: urlOf(townLighthouseUrl()),
        }}
      >
        <span
          className="town-harbour-lamp"
          data-tone={beaconOf(view)}
          style={{
            left: light.lamp.x - light.x,
            top: light.lamp.y - light.y,
          }}
          role="img"
          aria-label={`${repo} lighthouse: ${
            open ? open.main.words : shipyardBeaconWords("unknown")
          }`}
        />
      </span>
      {open && tally ? (
        <button
          type="button"
          className="town-harbour-hull"
          style={{
            left: hull.x,
            top: hull.y,
            backgroundImage: urlOf(townHullUrl(color)),
          }}
          aria-label={`Next release of ${repo}: ${open.cargo.count}${
            open.cargo.since ? ` ${open.cargo.since}` : ""
          }${openThis ? ". Open releases" : ""}`}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
          onClick={(event) => {
            event.stopPropagation();
            openThis?.();
          }}
        >
          <span className="town-harbour-tally" aria-hidden="true">
            {tally}
          </span>
        </button>
      ) : null}
      {ships.map((ship, berth) => (
        <Ship
          key={ship.release.id}
          ship={ship}
          at={townBerthAt(lot, index, berth + 1)}
          color={color}
          now={now}
          arriving={arriving.has(ship.release.id)}
          onOpenWork={openThis}
          onFocus={onFocus}
        />
      ))}
      <span className="town-harbour-announce" role="status">
        {ships
          .filter((ship) => arriving.has(ship.release.id))
          .map((ship) => `${repo} ${ship.release.tag} released.`)
          .join(" ")}
      </span>
    </div>
  );
}

const urlOf = (url: string) => (url ? `url("${url}")` : undefined);

/** A lane's pier, under its ships: planks, slipway, bollards and head. */
function Pier({ pier }: { pier: ReturnType<typeof townLanePierAt> }) {
  return (
    <span
      className="town-harbour-pier"
      style={{
        left: pier.x,
        top: pier.y - TOWN_PIER_ART.deck,
        width: pier.w,
        backgroundImage: urlOf(
          townPierUrl(pier.w, TOWN_PIER_SLIPWAY, TOWN_PIER_BOLLARDS),
        ),
      }}
      aria-hidden="true"
    />
  );
}

/** One release moored at its berth, opening its card. */
function Ship({
  ship,
  at,
  color,
  now,
  arriving,
  onOpenWork,
  onFocus,
}: {
  ship: ShipyardShip;
  at: { x: number; y: number };
  color: string;
  now: number;
  arriving: boolean;
  onOpenWork: (() => void) | null;
  onFocus: Reveal;
}) {
  const [open, setOpen] = useState(false);
  const flying = ship.running.some((instance) => instance.state === "fresh");
  const { release } = ship;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="town-harbour-ship"
          data-channel={release.channel}
          data-running={flying || undefined}
          data-arriving={arriving || undefined}
          style={{
            left: at.x,
            top: at.y,
            backgroundImage: urlOf(townShipUrl(release.channel, color)),
          }}
          aria-label={`Release ${shipWords(ship, now)}. Open`}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          {flying ? (
            <span
              className="town-harbour-pennant"
              style={{
                backgroundImage: urlOf(townFlagUrl("#5fbf5a", "pennant")),
              }}
              aria-hidden="true"
            />
          ) : null}
          <span className="town-harbour-tag" aria-hidden="true">
            {release.tag}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-harbour-popover"
        collisionPadding={8}
        aria-label={`Release ${release.tag}`}
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
        {onOpenWork ? (
          <button
            type="button"
            className="town-harbour-all"
            onClick={() => {
              setOpen(false);
              onOpenWork();
            }}
          >
            All releases
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The last lane when there are more projects than lanes: a board with how
 * many more, listing each to open in the Releases tab.
 */
function MoreLanes({
  lot,
  index,
  lanes,
  onOpenProject,
  onFocus,
}: {
  lot: TownHarbourLot;
  index: number;
  lanes: readonly Lane[];
  onOpenProject: OpenProject;
  onFocus: Reveal;
}) {
  const [open, setOpen] = useState(false);
  const sign = townLaneSignAt(lot, index);
  const pier = townLanePierAt(lot, index);
  return (
    <div
      className="town-harbour-lane"
      data-more
      data-at-x={pier.x + pier.w / 2}
      data-at-y={pier.y}
    >
      <Pier pier={pier} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="town-harbour-board"
            data-more
            style={{ left: sign.x, top: sign.y }}
            aria-label={`${lanes.length} more projects. List them`}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={onFocus}
          >
            <span className="town-harbour-board-name" aria-hidden="true">
              +{lanes.length} more
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="town-harbour-popover"
          collisionPadding={8}
          aria-label="More projects"
        >
          <header className="town-harbour-popover-title">
            <span className="town-harbour-icon" aria-hidden="true" />
            <span>MORE PROJECTS</span>
          </header>
          <ul className="town-harbour-more">
            {lanes.map((lane) => (
              <li key={lane.repo}>
                <button
                  type="button"
                  style={{ "--lane": lane.color } as CSSProperties}
                  disabled={!onOpenProject}
                  onClick={() => {
                    setOpen(false);
                    onOpenProject?.(lane.repo);
                  }}
                >
                  <i data-tone={beaconOf(lane.view)} aria-hidden="true" />
                  <b>{lane.repo}</b>
                  <span>{shipyardSignText(lane.view)}</span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
