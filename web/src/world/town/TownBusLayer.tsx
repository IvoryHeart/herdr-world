import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { binBusClock, type WorldBin } from "../bin/binStore";
import { openWorldBin } from "../bin/worldBinEvents";
import { useWorldBin, worldBinStore } from "../bin/useWorldBin";
import {
  TOWN_QUEUE_GAP,
  townBinRiders,
  townBusAlong,
  townBusAt,
  townBusOpacity,
  townBusRoute,
  townBusTimeline,
  townQueueLeft,
  townQueueMoreLeft,
  townQueueShape,
  townRiderFirstOuting,
  townRiderOuting,
  townRiderReturns,
  townRiderWalk,
  townRiderWalkBack,
  townStopClock,
  type TownBinRider,
  type TownBusRoute,
  type TownRiderOuting,
  type TownRiderReturn,
} from "./townBus";
import { createTownLookResolver } from "./townAppearance";
import {
  TOWN_AGENT_SCALE,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import {
  townCharacter,
  townLookKey,
  type TownDirection,
  type TownLook,
} from "./townSprites";
import "./townBus.css";

/** A rider steps aboard this long after the bus has stopped for it. */
const BOARD_S = 1.5;
/** The queue's drop area reaches this far past its last agent. */
const QUEUE_DROP_PAD = 14;

/**
 * Bin entries this page has shown outside, across Town's mounts: one binned
 * on Board walks from its door the first time Town shows it, not again.
 */
const shownOutside = new Set<string>();

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The bin as Town shows it: the agents it takes out of their rooms (`away`,
 * for the actors), those it draws at stops and those put back walking home
 * from them (`returning`, still away until they reach their door). The set
 * keeps its identity while its members are unchanged, so the actors resync
 * only on a change.
 */
export function useTownBin(model: TownModel, layout: TownLayout) {
  const bin = useWorldBin();
  const route = useMemo(() => townBusRoute(layout), [layout]);
  const placed = useMemo(
    () => townBinRiders(bin.entries, bin.closing, model, layout, route),
    [bin.entries, bin.closing, model, layout, route],
  );
  // Riders put back walk home from the queue; kept from the riders before.
  const [walks, setWalks] = useState<{
    riders: readonly TownBinRider[];
    returning: readonly TownRiderReturn[];
  }>(() => ({ riders: placed.riders, returning: [] }));
  if (walks.riders !== placed.riders)
    setWalks({
      riders: placed.riders,
      returning: townRiderReturns(
        walks.returning,
        walks.riders,
        placed.riders,
        bin,
        (id) => shownOutside.has(id) && !reducedMotion(),
        performance.now(),
      ),
    });
  const { returning } = walks;
  useEffect(() => {
    if (!returning.length) return;
    const end = Math.min(...returning.map((walk) => walk.end));
    const timer = setTimeout(
      () =>
        setWalks((current) => ({
          ...current,
          returning: current.returning.filter(
            (walk) => walk.end > performance.now(),
          ),
        })),
      Math.max(0, end - performance.now()) + 20,
    );
    return () => clearTimeout(timer);
  }, [returning]);
  const members = [
    ...new Set([
      ...placed.away,
      ...returning.map((walk) => walk.rider.agentKey),
    ]),
  ]
    .sort()
    .join("\n");
  const away: ReadonlySet<string> = useMemo(
    () => new Set(members ? members.split("\n") : []),
    [members],
  );
  // The look Town gives each agent indoors, so it is the same agent outside.
  const resolveLook = useMemo(() => createTownLookResolver(), []);
  const lookOf = useCallback(
    (key: string) => resolveLook(model.agents.get(key), key),
    [resolveLook, model],
  );
  return { bin, route, riders: placed.riders, returning, away, lookOf };
}

/** Paint an agent's character frame onto a rider's or passenger's canvas. */
function paint(
  canvas: HTMLCanvasElement,
  look: TownLook,
  dir: TownDirection,
  frame: number,
) {
  const key = `${townLookKey(look)}|${dir}|${frame}`;
  if (canvas.dataset.frame === key) return;
  canvas.dataset.frame = key;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(townCharacter(look, dir, frame, "stand", false), 0, 0);
}

/** A character frame's size in pixels (townCharacter). */
const SPRITE = { width: 14, height: 20 };
/** Seats shown in the bus's windows: upstairs, then downstairs. */
const SEATS = [4, 3] as const;

/** A clock that ticks each second while `running`. */
function useSecondClock(running: boolean) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * Town's bus stops, the agents waiting at them and the bus. A binned agent
 * leaves by its front door as the same character, walking as it walks
 * indoors, to the stop nearest its room, where a clock shows the time to
 * the next bus. While the service says a bus is out, it drives the route on
 * the trip's clock: it comes in, slows to each stop where someone waits,
 * stands there about 10 s while they board (and ride in its windows), then
 * speeds up and leaves. Clicking it stops it where it is (nothing closes
 * until it goes on) and opens the bin tray, as a stop does; closing the
 * tray lets it go on. Everyone waiting at a stop stands in its queue, up to
 * two rows and then a "+N" for the rest; when one leaves, those behind step
 * up, and one put back walks home to its front door.
 */
export const TownBusLayer = memo(function TownBusLayer({
  bin,
  route,
  riders,
  returning,
  lookOf,
  framed,
  renderer,
}: {
  bin: WorldBin;
  route: TownBusRoute;
  riders: readonly TownBinRider[];
  returning: readonly TownRiderReturn[];
  lookOf(key: string): TownLook;
  /** Set to a step the canvas calls on each drawn frame. */
  framed: { current: (() => void) | null };
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const bus = useRef<HTMLButtonElement>(null);
  const riderRefs = useRef(new Map<string, HTMLElement>());
  const passengerRefs = useRef(new Map<string, HTMLCanvasElement>());
  const walks = useRef(new Map<string, TownRiderOuting>());
  const homeRefs = useRef(new Map<string, HTMLElement>());
  const moreRefs = useRef(new Map<string, HTMLElement>());
  // Where each rider's place in its queue was, where it was last drawn, and
  // its step up the queue when its place moves.
  const places = useRef(new Map<string, TownPoint>());
  const drawn = useRef(new Map<string, TownPoint>());
  const steps = useRef(new Map<string, { from: TownPoint; start: number }>());
  const waiting = new Map<string, TownBinRider[]>();
  for (const rider of riders) {
    const list = waiting.get(rider.stop.key) ?? [];
    list.push(rider);
    waiting.set(rider.stop.key, list);
  }
  const passengers = riders.filter((rider) => rider.entry.riding);
  const now = useSecondClock(riders.length > 0);
  // The stops this trip halts at, kept for the whole trip so the bus never
  // jumps when a rider is put back; a stop is only ever added.
  const halting = useRef<{ trip: number | null; keys: Set<string> }>({
    trip: null,
    keys: new Set(),
  });
  if (halting.current.trip !== bin.bus.trip)
    halting.current = { trip: bin.bus.trip, keys: new Set() };
  for (const rider of passengers) halting.current.keys.add(rider.stop.key);
  const haltKey = [...halting.current.keys].sort().join("\n");
  const timeline = useMemo(
    () => townBusTimeline(route, new Set(haltKey.split("\n")), bin.bus.trip_ms),
    [route, haltKey, bin.bus.trip_ms],
  );
  // The next trip halts where those not yet riding wait.
  const nextKey = [
    ...new Set(
      riders.filter((r) => !r.entry.riding).map((rider) => rider.stop.key),
    ),
  ]
    .sort()
    .join("\n");
  const nextTimeline = useMemo(
    () => townBusTimeline(route, new Set(nextKey.split("\n")), bin.bus.trip_ms),
    [route, nextKey, bin.bus.trip_ms],
  );
  const busClock = binBusClock(bin, now);

  useEffect(() => {
    let frame = 0;
    const still = reducedMotion();
    const live = new Set(riders.map((rider) => rider.entry.id));
    for (const map of [walks, places, drawn, steps])
      for (const id of map.current.keys())
        if (!live.has(id)) map.current.delete(id);
    // One standing in the queue whose place moved steps up to it.
    for (const rider of riders) {
      const id = rider.entry.id;
      const place = places.current.get(id);
      const at = drawn.current.get(id);
      if (
        place &&
        at &&
        !still &&
        (place.x !== rider.at.x || place.y !== rider.at.y) &&
        (steps.current.has(id) ||
          Math.hypot(at.x - place.x, at.y - place.y) < 0.5)
      )
        steps.current.set(id, { from: at, start: performance.now() });
      places.current.set(id, rider.at);
    }
    const binned = new Set(
      [...bin.entries, ...bin.closing].map((entry) => entry.id),
    );
    for (const id of shownOutside) if (!binned.has(id)) shownOutside.delete(id);
    const tick = () => {
      frame = 0;
      const time = performance.now();
      const { elapsed } = binBusClock(bin, time);
      const along = elapsed === null ? null : townBusAlong(timeline, elapsed);
      let busy = elapsed !== null && !bin.bus.stopped;
      const element = bus.current;
      if (element) {
        element.hidden = along === null;
        if (along !== null) {
          const at = townBusAt(route, along);
          element.style.transform = `translate(${at.x}px, ${at.y}px)`;
          element.style.opacity = String(townBusOpacity(route, at.x));
          element.dataset.facing = at.facing;
        }
      }
      const handle = renderer.current;
      const aboard = new Set<string>();
      for (const rider of riders) {
        const id = rider.entry.id;
        const node = riderRefs.current.get(id);
        const canvas = node?.querySelector("canvas");
        if (!node || !canvas) continue;
        // Shown once its actor has gone out of the front door (the frame
        // just drawn); from then it walks to its stop.
        const walk = townRiderOuting(
          walks.current.get(id) ?? townRiderFirstOuting(shownOutside.has(id)),
          handle ? handle.actorPosition(rider.agentKey) === null : null,
          time,
          still,
        );
        walks.current.set(id, walk);
        const out = walk.out !== null;
        if (out) shownOutside.add(id);
        if (node.hasAttribute("data-out") !== out)
          node.toggleAttribute("data-out", out);
        let pose = townRiderWalk(
          rider.door,
          rider.at,
          walk.out === null ? Infinity : (time - walk.out) / 1000,
        );
        const step = steps.current.get(id);
        if (step && !pose.walking) {
          const stepping = townRiderWalk(
            step.from,
            rider.at,
            (time - step.start) / 1000,
          );
          if (stepping.walking) pose = stepping;
          else steps.current.delete(id);
        }
        if (out) drawn.current.set(id, { x: pose.x, y: pose.y });
        if (pose.walking) busy = true;
        // One counted in the "+N" waits unseen once it reaches the queue.
        const counted = rider.counted && !pose.walking;
        if (node.hasAttribute("data-queued") !== counted)
          node.toggleAttribute("data-queued", counted);
        const bob = pose.walking && pose.frame % 2 ? -1 : 0;
        node.style.translate = `${pose.x - rider.at.x}px ${pose.y - rider.at.y + bob}px`;
        const look = lookOf(rider.agentKey);
        paint(canvas, look, pose.dir, pose.frame);
        const halt = timeline.halts.get(rider.stop.key);
        const boarded =
          rider.entry.riding &&
          elapsed !== null &&
          along !== null &&
          (halt === undefined
            ? along >= rider.stop.at
            : elapsed / 1000 >= halt + BOARD_S);
        if (boarded) aboard.add(id);
        if (node.hasAttribute("data-boarded") !== boarded)
          node.toggleAttribute("data-boarded", boarded);
        const passenger = passengerRefs.current.get(id);
        if (passenger) {
          paint(passenger, look, "right", 0);
          if (passenger.hasAttribute("data-boarded") !== boarded)
            passenger.toggleAttribute("data-boarded", boarded);
        }
      }
      // A "+N" board counts only those not yet aboard, and comes down with
      // the last of them, so the stop empties as the bus takes its queue.
      const left = townQueueMoreLeft(riders, aboard);
      for (const [key, board] of moreRefs.current) {
        const more = left.get(key) ?? 0;
        if (board.dataset.more !== String(more))
          board.dataset.more = String(more);
        if (board.hidden !== (more === 0)) board.hidden = more === 0;
      }
      for (const walk of returning) {
        const node = homeRefs.current.get(walk.rider.entry.id);
        const canvas = node?.querySelector("canvas");
        if (!node || !canvas) continue;
        const { rider } = walk;
        const pose = townRiderWalkBack(
          rider.door,
          rider.at,
          (time - walk.start) / 1000,
        );
        if (pose.walking) busy = true;
        if (node.hasAttribute("data-out") !== pose.walking)
          node.toggleAttribute("data-out", pose.walking);
        const bob = pose.walking && pose.frame % 2 ? -1 : 0;
        node.style.translate = `${pose.x - rider.at.x}px ${pose.y - rider.at.y + bob}px`;
        paint(canvas, lookOf(rider.agentKey), pose.dir, pose.frame);
      }
      if (busy) frame = requestAnimationFrame(tick);
    };
    tick();
    framed.current = () => {
      if (!frame) tick();
    };
    return () => {
      framed.current = null;
      cancelAnimationFrame(frame);
    };
  }, [bin, route, riders, returning, timeline, lookOf, framed, renderer]);

  const [upstairs, downstairs] = SEATS;
  const seats = [
    passengers.slice(0, upstairs),
    passengers.slice(upstairs, upstairs + downstairs),
  ].map((deckRiders, deck) =>
    deckRiders.map((rider, seat) => (
      <canvas
        key={rider.entry.id}
        ref={(node) => {
          if (node) passengerRefs.current.set(rider.entry.id, node);
          else passengerRefs.current.delete(rider.entry.id);
        }}
        className="town-bus-passenger"
        width={SPRITE.width}
        height={SPRITE.height}
        style={{ left: 2 + seat * (deck ? 13 : 11) }}
      />
    )),
  );
  return (
    <div className="town-bus-layer" data-testid="town-bus">
      {route.stops.map((stop) => {
        const queue = waiting.get(stop.key) ?? [];
        const count = queue.length;
        const clock = count
          ? townStopClock({
              ...busClock,
              stopped: bin.bus.stopped,
              riding: queue.some((rider) => rider.entry.riding),
              halt: timeline.halts.get(stop.key),
              nextHalt: nextTimeline.halts.get(stop.key),
            })
          : null;
        const { shown, more, front } = townQueueShape(stop, count);
        const last = queue.find((rider) => rider.counted);
        // The stop's drop area runs from its sign along its whole queue.
        const reach = count
          ? stop.wait.x - townQueueLeft(stop, shown + (more ? 1 : 0))
          : 0;
        return [
          <button
            key={stop.key}
            type="button"
            className="town-bus-stop"
            data-stop={stop.key}
            data-waiting={count || undefined}
            style={{
              left: stop.wait.x,
              top: stop.wait.y,
              width:
                reach > 0
                  ? `max(96px, ${reach + 28 + QUEUE_DROP_PAD}px)`
                  : undefined,
            }}
            // An empty stop is scenery; the bin is also reachable from its chip.
            tabIndex={count ? 0 : -1}
            aria-hidden={count ? undefined : true}
            aria-label={
              count ? `Bus stop, ${count} waiting, bus ${clock}` : undefined
            }
            // Dropping an agent here (its sign or its queue) puts it in the bin.
            data-bin-drop=""
            onClick={openWorldBin}
          >
            <span className="town-bus-pole" aria-hidden="true" />
            <span className="town-bus-flag" aria-hidden="true">
              <span className="town-bus-roundel" />
            </span>
          </button>,
          more && last ? (
            <span
              key={`${stop.key}-more`}
              ref={(node) => {
                if (node) moreRefs.current.set(stop.key, node);
                else moreRefs.current.delete(stop.key);
              }}
              className="town-bus-more"
              data-more-stop={stop.key}
              // The count shows from data-more, which each frame lowers as
              // the bus takes those it counts.
              data-more={more}
              aria-hidden="true"
              style={{ left: last.at.x, top: last.at.y }}
            />
          ) : null,
          clock ? (
            <span
              key={`${stop.key}-clock`}
              className="town-bus-clock"
              data-clock={stop.key}
              aria-hidden="true"
              style={{
                left: stop.wait.x - ((front - 1) * TOWN_QUEUE_GAP) / 2,
                top: stop.wait.y - SPRITE.height * TOWN_AGENT_SCALE - 2,
              }}
            >
              <i />
              {clock}
            </span>
          ) : null,
        ];
      })}
      {riders.map((rider) => (
        <div
          key={rider.entry.id}
          ref={(node) => {
            if (node) riderRefs.current.set(rider.entry.id, node);
            else riderRefs.current.delete(rider.entry.id);
          }}
          className="town-bin-rider"
          data-agent={rider.agentKey}
          data-bin-entry={rider.entry.id}
          title={`${rider.entry.label}, waiting for the bus`}
          style={{ left: rider.at.x, top: rider.at.y }}
        >
          <canvas width={SPRITE.width} height={SPRITE.height} />
        </div>
      ))}
      {returning.map(({ rider }) => (
        <div
          key={rider.entry.id}
          ref={(node) => {
            if (node) homeRefs.current.set(rider.entry.id, node);
            else homeRefs.current.delete(rider.entry.id);
          }}
          className="town-bin-rider"
          data-agent={rider.agentKey}
          data-returning=""
          aria-hidden="true"
          style={{ left: rider.at.x, top: rider.at.y }}
        >
          <canvas width={SPRITE.width} height={SPRITE.height} />
        </div>
      ))}
      <button
        ref={bus}
        type="button"
        className="town-bus"
        hidden
        data-stopped={bin.bus.stopped || undefined}
        aria-label={
          bin.bus.stopped
            ? `The bus, stopped, ${passengers.length} aboard`
            : `The bus, ${passengers.length} aboard; stop it`
        }
        onClick={() => {
          // Stopped, nothing closes until it goes on: from the tray, or as
          // the tray is closed.
          if (!bin.bus.stopped) void worldBinStore().stopBus();
          openWorldBin();
        }}
      >
        <span className="town-bus-deck" aria-hidden="true">
          {seats[0]}
        </span>
        <span className="town-bus-deck town-bus-lower" aria-hidden="true">
          {seats[1]}
        </span>
      </button>
    </div>
  );
});
