import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { binBusClock, binClockLabel, type WorldBin } from "../bin/binStore";
import { openWorldBin } from "../bin/worldBinEvents";
import { useWorldBin, worldBinStore } from "../bin/useWorldBin";
import {
  TOWN_QUEUE_GAP,
  TOWN_STOP_QUEUE,
  townBinRiders,
  townBusAlong,
  townBusAt,
  townBusOpacity,
  townBusRoute,
  townBusTimeline,
  townRiderWalk,
  type TownBinRider,
  type TownBusRoute,
} from "./townBus";
import { createTownLookResolver } from "./townAppearance";
import { TOWN_AGENT_SCALE, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import {
  townCharacter,
  townLookKey,
  type TownDirection,
  type TownLook,
} from "./townSprites";
import "./townBus.css";

/** An entry this page first saw longer ago has already walked to its stop. */
const WALKED_MS = 15_000;
/** A rider steps aboard this long after the bus has stopped for it. */
const BOARD_S = 1.5;

/**
 * The bin as Town shows it: the agents it takes out of their rooms (`away`,
 * for the actors) and those it draws at stops. The set keeps its identity
 * while its members are unchanged, so the actors resync only on a change.
 */
export function useTownBin(model: TownModel, layout: TownLayout) {
  const bin = useWorldBin();
  const route = useMemo(() => townBusRoute(layout), [layout]);
  const placed = useMemo(
    () => townBinRiders(bin.entries, bin.closing, model, layout, route),
    [bin.entries, bin.closing, model, layout, route],
  );
  const members = [...placed.away].sort().join("\n");
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
  return { bin, route, riders: placed.riders, away, lookOf };
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

/** A waiting rider's walk, from when its actor was seen out of the door. */
type Walk = { out: number | null };

/** What a stop's clock reads: the next bus, or the one at the stops now. */
function stopClock(bin: WorldBin, now: number, riding: boolean) {
  const { elapsed, next } = binBusClock(bin, now);
  if (elapsed !== null && riding) return bin.bus.stopped ? "stopped" : "due";
  return binClockLabel(next);
}

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
 * tray lets it go on.
 */
export const TownBusLayer = memo(function TownBusLayer({
  bin,
  route,
  riders,
  lookOf,
  framed,
  renderer,
  firstSeen,
}: {
  bin: WorldBin;
  route: TownBusRoute;
  riders: readonly TownBinRider[];
  lookOf(key: string): TownLook;
  /** Set to a step the canvas calls on each drawn frame. */
  framed: { current: (() => void) | null };
  renderer: { readonly current: TownRendererHandle | null };
  firstSeen(id: string): number;
}) {
  const bus = useRef<HTMLButtonElement>(null);
  const riderRefs = useRef(new Map<string, HTMLElement>());
  const passengerRefs = useRef(new Map<string, HTMLCanvasElement>());
  const walks = useRef(new Map<string, Walk>());
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

  useEffect(() => {
    let frame = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const live = new Set(riders.map((rider) => rider.entry.id));
    for (const id of walks.current.keys())
      if (!live.has(id)) walks.current.delete(id);
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
      for (const rider of riders) {
        const id = rider.entry.id;
        const node = riderRefs.current.get(id);
        const canvas = node?.querySelector("canvas");
        if (!node || !canvas) continue;
        let walk = walks.current.get(id);
        if (!walk) walks.current.set(id, (walk = { out: null }));
        // Shown once its actor has gone out of the front door (the frame
        // just drawn); from then it walks to its stop.
        const out = handle
          ? handle.actorPosition(rider.agentKey) === null
          : false;
        if (!out) walk.out = null;
        else if (walk.out === null)
          walk.out =
            !still && time - firstSeen(id) < WALKED_MS ? time : -Infinity;
        if (node.hasAttribute("data-out") !== out)
          node.toggleAttribute("data-out", out);
        const pose = townRiderWalk(
          rider.door,
          rider.at,
          walk.out === null ? Infinity : (time - walk.out) / 1000,
        );
        if (pose.walking) busy = true;
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
        if (node.hasAttribute("data-boarded") !== boarded)
          node.toggleAttribute("data-boarded", boarded);
        const passenger = passengerRefs.current.get(id);
        if (passenger) {
          paint(passenger, look, "right", 0);
          if (passenger.hasAttribute("data-boarded") !== boarded)
            passenger.toggleAttribute("data-boarded", boarded);
        }
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
  }, [bin, route, riders, timeline, lookOf, framed, renderer, firstSeen]);

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
          ? stopClock(
              bin,
              now,
              queue.some((rider) => rider.entry.riding),
            )
          : null;
        const shown = Math.min(count, TOWN_STOP_QUEUE);
        return [
          <button
            key={stop.key}
            type="button"
            className="town-bus-stop"
            data-stop={stop.key}
            data-waiting={count || undefined}
            style={{ left: stop.wait.x, top: stop.wait.y }}
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
            {count > TOWN_STOP_QUEUE ? (
              <em>+{count - TOWN_STOP_QUEUE}</em>
            ) : null}
          </button>,
          clock ? (
            <span
              key={`${stop.key}-clock`}
              className="town-bus-clock"
              data-clock={stop.key}
              aria-hidden="true"
              style={{
                left: stop.wait.x - ((shown - 1) * TOWN_QUEUE_GAP) / 2,
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
          data-queued={rider.slot >= TOWN_STOP_QUEUE || undefined}
          title={`${rider.entry.label}, waiting for the bus`}
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
