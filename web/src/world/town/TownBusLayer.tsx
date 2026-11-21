import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  binBusClock,
  binBusCountdown,
  binBusLabel,
  type WorldBin,
} from "../bin/binStore";
import { useBinSecondClock } from "../bin/binSecondClock";
import { openWorldBin } from "../bin/worldBinEvents";
import { useWorldBin, worldBinStore } from "../bin/useWorldBin";
import {
  TOWN_QUEUE_GAP,
  townBinRiders,
  townBusRoute,
  townQueueLeft,
  townQueueMoreLeft,
  townQueueShape,
  townRiderFirstOuting,
  townRiderOuting,
  townRiderReturns,
  townRiderWalk,
  townRiderWalkBack,
  townWalkAlong,
  townWalkLength,
  type TownBinRider,
  type TownBusRoute,
  type TownRiderOuting,
  type TownRiderReturn,
} from "./townBus";
import {
  townBusDoor,
  townBusParked,
  townBusPose,
  townBusTimeline,
} from "./townBusDrive";
import {
  townBusDemoBin,
  townBusDemoNext,
  townBusDemoShown,
  townBusDemoStart,
} from "./townBusDemo";
import { townApartmentsArrive } from "./townApartmentsArrivals";
import { TOWN_WALK_SPEED } from "./townActors";
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

/** Riders at one stop step aboard at most this far apart, in seconds. */
const BOARD_STEP_S = 0.6;
/** The queue's drop area reaches this far past its last agent. */
const QUEUE_DROP_PAD = 14;

/**
 * Bin entries this page has shown outside, across Town's mounts: one binned
 * on Board walks from its door the first time Town shows it, not again.
 */
const shownOutside = new Set<string>();
/** Riders this page has counted in at Apartments' door, across mounts. */
const arrived = new Set<string>();

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
  const served = useWorldBin();
  // ?townBusDemo: a local trip in place of the service's bin (townBusDemo.ts).
  const [demo] = useState(townBusDemoStart);
  const [demoNow, setDemoNow] = useState(() => performance.now());
  useEffect(() => {
    if (demo === null) return;
    const next = townBusDemoNext(demo, demoNow);
    if (next === null) return;
    const timer = setTimeout(
      () => setDemoNow(performance.now()),
      Math.max(0, next - performance.now()) + 20,
    );
    return () => clearTimeout(timer);
  }, [demo, demoNow]);
  const demoBin = useMemo(
    () => (demo === null ? null : townBusDemoBin(model, demo, demoNow)),
    [demo, model, demoNow],
  );
  useEffect(() => {
    if (!demoBin) return;
    townBusDemoShown.set(demoBin);
    return () => townBusDemoShown.set(null);
  }, [demoBin]);
  const bin = demoBin ?? served;
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
  return {
    bin,
    route,
    riders: placed.riders,
    returning,
    away,
    lookOf,
    demo: demo !== null,
  };
}

/**
 * Paint an agent's character frame onto a rider's, passenger's or arriving
 * agent's canvas (TownArrivalLayer).
 */
export function paintTownRider(
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
/**
 * Riders seen through its front or back windows on a side road: two
 * upstairs, two downstairs, so a rider never drops out of sight aboard.
 */
const END_SEATS = [2, 2] as const;

/**
 * One trip as this page draws it, kept for the whole trip so the bus never
 * jumps when a rider is put back: the stops it halts at and its riders in
 * the order they boarded, which is the order they step off (only ever added).
 */
type TownTripPlan = { trip: number | null; keys: Set<string>; order: string[] };

/** Where a riding agent is in its trip. */
type TownRide = "queue" | "boarding" | "aboard" | "alighting" | "home";

/** The halts a trip makes, for townBusTimeline, from its stops' keys. */
function haltsOf(route: TownBusRoute, keys: string) {
  const wanted = new Set(keys ? keys.split("\n") : []);
  return route.stops
    .filter((stop) => wanted.has(stop.key))
    .map((stop) => ({ key: stop.key, at: stop.halt }));
}

/**
 * Town's bus stops, the agents waiting at them and the bus. Each stop's sign
 * is street furniture the canvas draws (townRendererScene.ts); here a stop
 * is its tap and drop area over that sign and its queue. A binned agent
 * leaves by its front door as the same character, walking as it walks
 * indoors, to the stop nearest its room, where a clock shows the bin's own
 * countdown to the next bus (binBusCountdown, on the shared second clock).
 * The bus lives at Apartments' stop. While the service says a trip is out, it drives the town's roads on the trip's clock, the nearest
 * way past each stop where someone waits (townBusDrive.ts): it pulls away,
 * turns its corners, slows and stops, opens its doors while they step aboard
 * (and ride in its windows), and drives back to Apartments, where they step
 * off one by one and walk in at the door, the sign counting each, the last
 * just before the trip ends and they close. Clicking it on a trip stops it
 * where it is (nothing closes until it goes on) and opens the bin tray, as a
 * stop does; closing the tray lets it go on. Everyone waiting at a stop
 * stands in its queue, up to two rows and then a "+N" for the rest; when
 * one leaves, those behind step up, and one put back walks home to its
 * front door.
 */
export const TownBusLayer = memo(function TownBusLayer({
  bin,
  route,
  riders,
  returning,
  lookOf,
  framed,
  renderer,
  demo = false,
}: {
  bin: WorldBin;
  route: TownBusRoute;
  riders: readonly TownBinRider[];
  returning: readonly TownRiderReturn[];
  lookOf(key: string): TownLook;
  /** Set to a step the canvas calls on each drawn frame. */
  framed: { current: (() => void) | null };
  renderer: { readonly current: TownRendererHandle | null };
  /** The bin is ?townBusDemo's local stand-in: the bus is not the service's. */
  demo?: boolean;
}) {
  const bus = useRef<HTMLButtonElement>(null);
  const riderRefs = useRef(new Map<string, HTMLElement>());
  const passengerRefs = useRef(new Map<string, HTMLCanvasElement>());
  const endRefs = useRef(new Map<string, HTMLCanvasElement>());
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
  // The canvas draws the stops' signs; those where agents wait show red.
  const waitingKey = [...waiting.keys()].sort().join("\n");
  const waitingStops = useMemo(
    () => new Set(waitingKey ? waitingKey.split("\n") : []),
    [waitingKey],
  );
  const now = useBinSecondClock(riders.length > 0);
  const { terminus } = route;
  const walkS = terminus ? townWalkLength(terminus.walk) / TOWN_WALK_SPEED : 0;
  const plan = useRef<TownTripPlan>({ trip: null, keys: new Set(), order: [] });
  if (plan.current.trip !== bin.bus.trip)
    plan.current = { trip: bin.bus.trip, keys: new Set(), order: [] };
  const riding = riders.filter((rider) => rider.entry.riding);
  for (const rider of riding) plan.current.keys.add(rider.stop.key);
  const haltKey = [...plan.current.keys].sort().join("\n");
  // Room for every rider the trip has had, so a put-back one moves no one.
  const seated = new Set([
    ...plan.current.order,
    ...riding.map((rider) => rider.entry.id),
  ]).size;
  const timeline = useMemo(
    () =>
      terminus
        ? townBusTimeline(
            route.graph,
            terminus.halt,
            haltsOf(route, haltKey),
            seated,
            walkS,
            bin.bus.trip_ms,
          )
        : null,
    [route, terminus, haltKey, seated, walkS, bin.bus.trip_ms],
  );
  if (timeline) {
    const haltAt = (rider: TownBinRider) =>
      timeline.halts.get(rider.stop.key)?.at ?? timeline.start;
    plan.current.order.push(
      ...riding
        .filter((rider) => !plan.current.order.includes(rider.entry.id))
        .sort((a, b) => haltAt(a) - haltAt(b) || a.slot - b.slot)
        .map((rider) => rider.entry.id),
    );
  }
  const passengers = [...riding].sort(
    (a, b) =>
      plan.current.order.indexOf(a.entry.id) -
      plan.current.order.indexOf(b.entry.id),
  );
  const busClock = binBusClock(bin, now);
  const onTrip = busClock.elapsed !== null;

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
    // Who boards first at each stop: its queue's order.
    const boarding = new Map<string, { index: number; count: number }>();
    const atStop = new Map<string, TownBinRider[]>();
    for (const rider of riders)
      if (rider.entry.riding)
        atStop.set(rider.stop.key, [
          ...(atStop.get(rider.stop.key) ?? []),
          rider,
        ]);
    for (const queue of atStop.values())
      queue.forEach((rider, index) =>
        boarding.set(rider.entry.id, { index, count: queue.length }),
      );
    const order = plan.current.order;
    const tick = () => {
      frame = 0;
      const time = performance.now();
      const { elapsed } = binBusClock(bin, time);
      // Its trip has ended and the service has yet to say so: riders are in.
      const over = bin.bus.elapsed_ms !== null && elapsed === null;
      const e = elapsed === null ? null : elapsed / 1000;
      let busy = elapsed !== null && !bin.bus.stopped;
      const element = bus.current;
      // Riders face the way it drives: towards us coming down a side road.
      let endDir: TownDirection = "down";
      if (element) {
        const pose = !terminus
          ? null
          : elapsed === null || !timeline
            ? townBusParked(terminus.halt)
            : townBusPose(timeline, terminus.halt, elapsed);
        element.hidden = !pose;
        if (pose) {
          element.style.transform = `translate(${pose.x}px, ${pose.y}px)`;
          element.style.setProperty("--tilt", `${pose.tilt.toFixed(2)}deg`);
          if (element.dataset.facing !== pose.facing)
            element.dataset.facing = pose.facing;
          if (pose.facing === "up") endDir = "up";
          element.toggleAttribute("data-doors", pose.doors);
          element.toggleAttribute("data-moving", pose.moving && !still);
          element.toggleAttribute("data-braking", pose.braking);
        }
      }
      const handle = renderer.current;
      handle?.setWaitingStops(waitingStops);
      const gone = new Set<string>();
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
        let ride: TownRide = "queue";
        if (rider.entry.riding && timeline && terminus) {
          if (over) ride = "home";
          else if (e !== null) {
            // Off at Apartments in the order they got on, then in at its door.
            const k = Math.max(0, order.indexOf(id));
            const off = timeline.arrive.open + k * timeline.arrive.step;
            const halt = timeline.halts.get(rider.stop.key);
            if (e >= off) {
              const walked = townWalkAlong(
                terminus.walk,
                (e - off) * TOWN_WALK_SPEED,
              );
              ride = walked.walking ? "alighting" : "home";
              pose = walked;
            } else if (!halt) {
              if (e >= timeline.start) ride = "aboard";
            } else {
              // Along the pavement to the bus's front door, and aboard.
              const turn = boarding.get(id) ?? { index: 0, count: 1 };
              const on =
                halt.open +
                turn.index *
                  Math.min(
                    BOARD_STEP_S,
                    ((halt.close - halt.open) * 0.5) / turn.count,
                  );
              if (e >= on) {
                const door = townBusDoor(
                  halt.point,
                  halt.facing,
                  rider.stop.wait.y,
                );
                const path = [rider.at, { x: door.x, y: rider.at.y }, door];
                const length = townWalkLength(path);
                const seconds = Math.max(
                  0.05,
                  Math.min(length / TOWN_WALK_SPEED, halt.close - on),
                );
                const walked = townWalkAlong(
                  path,
                  ((e - on) / seconds) * length,
                );
                ride = walked.walking ? "boarding" : "aboard";
                if (walked.walking) pose = walked;
              }
            }
          }
        }
        if (ride !== "queue") gone.add(id);
        if (
          ride === "home" &&
          terminus?.to === "apartments" &&
          !arrived.has(id)
        ) {
          arrived.add(id);
          townApartmentsArrive({
            id,
            connection_id: rider.entry.connection_id,
            terminal_id: rider.entry.terminal_id,
            at: time,
            demo,
          });
        }
        if (node.dataset.ride !== ride) node.dataset.ride = ride;
        const shown = out || ride !== "queue";
        if (node.hasAttribute("data-out") !== shown)
          node.toggleAttribute("data-out", shown);
        if (ride === "queue" && out)
          drawn.current.set(id, { x: pose.x, y: pose.y });
        if (pose.walking) busy = true;
        // One counted in the "+N" waits unseen once it reaches the queue.
        const counted = rider.counted && !pose.walking && ride === "queue";
        if (node.hasAttribute("data-queued") !== counted)
          node.toggleAttribute("data-queued", counted);
        const bob = pose.walking && pose.frame % 2 ? -1 : 0;
        node.style.translate = `${pose.x - rider.at.x}px ${pose.y - rider.at.y + bob}px`;
        const look = lookOf(rider.agentKey);
        paintTownRider(canvas, look, pose.dir, pose.frame);
        const passenger = passengerRefs.current.get(id);
        if (passenger) {
          paintTownRider(passenger, look, "right", 0);
          const seen = ride === "aboard";
          if (passenger.hasAttribute("data-boarded") !== seen)
            passenger.toggleAttribute("data-boarded", seen);
        }
        const ahead = endRefs.current.get(id);
        if (ahead) {
          paintTownRider(ahead, look, endDir, 0);
          const seen = ride === "aboard";
          if (ahead.hasAttribute("data-boarded") !== seen)
            ahead.toggleAttribute("data-boarded", seen);
        }
      }
      // A "+N" board counts only those still in the queue, and comes down
      // with the last of them, so the stop empties as the bus takes it.
      const left = townQueueMoreLeft(riders, gone);
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
        paintTownRider(canvas, lookOf(rider.agentKey), pose.dir, pose.frame);
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
  }, [
    bin,
    terminus,
    riders,
    returning,
    timeline,
    lookOf,
    framed,
    renderer,
    waitingStops,
    demo,
  ]);

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
  const [endUpper, endLower] = END_SEATS;
  const endSeats = [
    passengers.slice(0, endUpper),
    passengers.slice(endUpper, endUpper + endLower),
  ].map((deckRiders) =>
    deckRiders.map((rider) => (
      <canvas
        key={rider.entry.id}
        ref={(node) => {
          if (node) endRefs.current.set(rider.entry.id, node);
          else endRefs.current.delete(rider.entry.id);
        }}
        className="town-bus-passenger town-bus-end-passenger"
        width={SPRITE.width}
        height={SPRITE.height}
      />
    )),
  );
  const home = terminus?.to === "apartments" ? "Apartments" : "the town center";
  return (
    <div className="town-bus-layer" data-testid="town-bus">
      {route.stops.map((stop) => {
        const queue = waiting.get(stop.key) ?? [];
        const count = queue.length;
        // The bin's countdown, from the same timetable at the same instant.
        const clock = count ? binBusCountdown(bin, now) : null;
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
              count
                ? `Bus stop, ${count} waiting, ${binBusLabel(bin, now)}`
                : undefined
            }
            // Dropping an agent here (its sign or its queue) puts it in the bin.
            data-bin-drop=""
            onClick={openWorldBin}
          />,
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
          title={
            rider.entry.riding
              ? `${rider.entry.label}, on the bus to ${home}`
              : `${rider.entry.label}, waiting for the bus`
          }
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
        data-facing="right"
        hidden={!terminus}
        data-stopped={(onTrip && bin.bus.stopped) || undefined}
        data-trip={onTrip || undefined}
        aria-label={
          !onTrip
            ? `The bus, at ${home}`
            : bin.bus.stopped
              ? `The bus, stopped, ${passengers.length} aboard`
              : `The bus to ${home}, ${passengers.length} aboard; stop it`
        }
        onClick={() => {
          // Stopped, nothing closes until it goes on: from the tray, or as
          // the tray is closed. Parked, it opens the tray.
          if (onTrip && !bin.bus.stopped && !demo)
            void worldBinStore().stopBus();
          openWorldBin();
        }}
      >
        <span className="town-bus-side" aria-hidden="true">
          <span className="town-bus-deck">{seats[0]}</span>
          <span className="town-bus-deck town-bus-lower">{seats[1]}</span>
          <span className="town-bus-door" />
          <span className="town-bus-wheel" />
          <span className="town-bus-wheel town-bus-wheel-back" />
        </span>
        <span className="town-bus-end" aria-hidden="true">
          <span className="town-bus-end-window">{endSeats[0]}</span>
          <span className="town-bus-end-window town-bus-end-lower">
            {endSeats[1]}
          </span>
        </span>
      </button>
    </div>
  );
});
