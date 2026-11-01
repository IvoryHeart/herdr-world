import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { bridge } from "../../api";
import type { BinEntry } from "../../../../shared/bin";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { binOutcomeText } from "../bin/WorldBin";
import { playBinSound } from "../bin/binSounds";
import { useWorldBin, worldBinStore } from "../bin/binStore";
import {
  binDropOfAgent,
  binnedAgents,
  withoutBinnedAgents,
} from "../bin/binTown";
import {
  inTownBusDropZone,
  townBusRiderAt,
  type TownBusScene,
} from "./scene/townBus";
import type { TownHud } from "./scene/townHud";
import type { TownSceneCamera } from "./scene/townSceneCamera";
import { BUS_H, BUS_W, STOP_H, STOP_W } from "./townBusGeometry";
import {
  freeScreenArea,
  insideScreenArea,
  townPanels,
  type ScreenRect,
} from "./townBusReach";
import { TownBusLayer } from "./townBusLayer";
import type { TownLayout } from "./townLayout";
import type { TownMoveResult } from "./townMoves";
import type { TownRendererHandle } from "./townRenderer";
import "./townBus.css";

type Point = { x: number; y: number };
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type TownCamera = NonNullable<TownSceneCamera["camera"]>;

/** The camera's view without its chrome insets, in screen pixels. */
const viewArea = (camera: TownCamera): ScreenRect => {
  const { width, height, inset } = camera.viewport;
  return {
    left: inset.left,
    top: inset.top,
    right: width - inset.right,
    bottom: height - inset.bottom,
  };
};

/** The stop, its sign and the bus standing beside it, in screen pixels. */
const stopBox = (camera: TownCamera, l: TownLayout): ScreenRect => {
  const pole = l.busStop.x * 16 + 8;
  const a = camera.toScreen(
    pole - STOP_W / 2 - BUS_W - 4,
    l.busStop.y * 16 + 16 - STOP_H - 16,
  );
  const b = camera.toScreen(
    pole + STOP_W,
    l.busStop.road * 16 + 16 + 2 + BUS_H,
  );
  return { left: a.x, top: a.y, right: b.x, bottom: b.y };
};

/** The mounted Town's way to send an agent to the stop (the peek's action). */
export const townBusSender: {
  send: ((agentKey: string) => Promise<TownMoveResult>) | null;
} = { send: null };

/**
 * Town's side of the bin: the bus stop on the top street, the buses, and
 * their controls. Agents waiting in the bin leave their desks and ride.
 */
export function useTownBus({
  projection,
  layout,
  ready,
  rendererRef,
  host,
  view,
  hud,
}: {
  projection: HerdrOfficeProjection;
  /** The town as drawn (it is laid out from the projection this returns). */
  layout(): TownLayout | null;
  ready: boolean;
  rendererRef: RefObject<TownRendererHandle | null>;
  /** The town's canvas, whose screen the camera and the chip share. */
  host: RefObject<HTMLElement | null>;
  view: TownSceneCamera;
  hud(): TownHud;
}) {
  const store = worldBinStore(bridge);
  const bin = useWorldBin(store);
  const riders = useMemo(
    () => binnedAgents(projection, bin.entries),
    [projection, bin.entries],
  );
  const town = useMemo(
    () =>
      withoutBinnedAgents(
        projection,
        new Set([...riders.values()].map((agent) => agent.key)),
      ),
    [projection, riders],
  );
  const latest = useRef({ riders, bin });
  latest.current = { riders, bin };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /**
   * The bus layer lives exactly as long as its attachment: made when the
   * renderer is ready, destroyed in the same effect's cleanup. (StrictMode
   * runs setup, cleanup, setup: a layer kept in state would come back
   * destroyed and be attached again.)
   */
  const layerRef = useRef<TownBusLayer | null>(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer) return;
    const layer = new TownBusLayer({
      layout: () => layoutRef.current(),
      entries: () => latest.current.bin.entries,
      remaining: (entry) => store.remaining(entry),
      paused: () => latest.current.bin.paused,
      agent: (id) => latest.current.riders.get(id),
    });
    layerRef.current = layer;
    renderer.setOverlay(layer);
    return () => {
      renderer.setOverlay(null);
      if (layerRef.current === layer) layerRef.current = null;
      layer.destroy();
    };
  }, [ready, rendererRef, store]);

  // A second clock for the sign and chip, and to start each departure.
  const [, tick] = useState(0);
  const holding = bin.entries.length > 0;
  useEffect(() => {
    rendererRef.current?.invalidate("bin");
    if (!holding || bin.paused) return;
    const timer = window.setInterval(() => {
      tick((n) => n + 1);
      rendererRef.current?.invalidate("bus-clock");
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bin, holding, rendererRef]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(
    () =>
      store.onOutcome((outcome) => {
        if (outcome.result === "closed") playBinSound("close");
        setToast(binOutcomeText(outcome));
      }),
    [store],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const report = (error: unknown) => {
    playBinSound("refuse");
    setToast(error instanceof Error ? error.message : String(error));
  };

  /** Stage an agent for the bus; Town lands it at the stop or springs back. */
  const send = async (
    key: string,
    carried: "agent" | "desk" = "agent",
  ): Promise<TownMoveResult> => {
    // A desk sends its agent (its first agent pane).
    const agentKey =
      carried === "desk"
        ? projection.rooms
            .flatMap((room) => room.desks)
            .find((desk) => desk.key === key)
            ?.paneDevices.find((device) => device.agentKey)?.agentKey
        : key;
    if (!agentKey) {
      report("Only agents ride the bus; this desk has none");
      return "returned";
    }
    const drop = binDropOfAgent(projection, agentKey, "town", bin.entries);
    if ("refusal" in drop) {
      report(drop.refusal);
      return "returned";
    }
    const soonest = [...bin.entries].sort(
      (a, b) => store.remaining(a) - store.remaining(b),
    )[0];
    try {
      await store.add(soonest ? { ...drop, join: soonest.id } : drop);
      playBinSound("drop");
      return "moved";
    } catch (error) {
      report(error);
      return "returned";
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const sender = (agentKey: string) => sendRef.current(agentKey);
    townBusSender.send = sender;
    return () => {
      if (townBusSender.send === sender) townBusSender.send = null;
    };
  }, []);

  // The off-screen chip: where the stop is, as of the last drawn frame.
  const chip = useRef<HTMLButtonElement | null>(null);
  const [edge, setEdgeState] = useState<Point | null>(null);
  const [carrying, setCarryingState] = useState(false);
  // Called every frame: set state only when it changes, so Town does not
  // render again each frame (each render derives the town's scene).
  const shown = useRef<{ edge: Point | null; carrying: boolean }>({
    edge: null,
    carrying: false,
  });
  const setEdge = (next: Point | null) => {
    const was = shown.current.edge;
    if (was?.x === next?.x && was?.y === next?.y) return;
    shown.current.edge = next;
    setEdgeState(next);
  };
  const setCarrying = (next: boolean) => {
    if (shown.current.carrying === next) return;
    shown.current.carrying = next;
    setCarryingState(next);
  };
  const setters = useRef({ setEdge, setCarrying });
  setters.current = { setEdge, setCarrying };
  useEffect(
    () =>
      hud().onFrame(() => {
        // A carry shows the drag ghost; its absence ends a carry for sure.
        const carried = document.querySelector(".town-drag-ghost") !== null;
        const { setEdge, setCarrying } = setters.current;
        setCarrying(carried);
        const camera = view.camera;
        const l = layout();
        const canvas = host.current;
        if (!camera || !l || !canvas) return;
        if (!carried && !latest.current.bin.entries.length) {
          setEdge(null);
          return;
        }
        // Where the stop and its waiting bus can be pressed: not off screen,
        // and not under the asks rail or the zoom column.
        const free = freeScreenArea(viewArea(camera), townPanels(canvas));
        const box = stopBox(camera, l);
        const padX = 72,
          padY = 32;
        const next = insideScreenArea(free, box)
          ? null
          : {
              x:
                Math.round(
                  Math.min(
                    free.right - padX,
                    Math.max(free.left + padX, (box.left + box.right) / 2),
                  ) / 4,
                ) * 4,
              y:
                Math.round(
                  Math.min(
                    free.bottom - padY,
                    Math.max(free.top + padY, (box.top + box.bottom) / 2),
                  ) / 4,
                ) * 4,
            };
        setEdge(next);
      }),
    [hud, view, layout, host],
  );
  /** Fly the stop and its bus into the middle of the town's free area. */
  const flyToStop = () => {
    const camera = view.camera;
    const l = layout();
    const canvas = host.current;
    if (!camera || !l || !canvas) return;
    const free = freeScreenArea(viewArea(camera), townPanels(canvas));
    const box = stopBox(camera, l);
    const focus = camera.focusPoint();
    const z = camera.z;
    // The stop box's centre, in world pixels, placed at the free area's centre.
    const at = camera.toWorld(
      (box.left + box.right) / 2,
      (box.top + box.bottom) / 2,
    );
    camera.flyTo(
      at.x - ((free.left + free.right) / 2 - focus.x) / z,
      at.y - ((free.top + free.bottom) / 2 - focus.y) / z,
      z,
      0.6,
    );
    rendererRef.current?.invalidate("bus-stop");
  };

  /** A carried agent at this point is over the stop, its buses or the chip. */
  const over = (world: Point, at: Point) => {
    const scene = layerRef.current?.scene;
    if (scene && inTownBusDropZone(scene, world.x, world.y)) return true;
    const rect = chip.current?.getBoundingClientRect();
    const host = chip.current?.parentElement?.getBoundingClientRect();
    if (!rect || !host) return false;
    const x = at.x + host.left,
      y = at.y + host.top;
    return (
      x >= rect.left - 12 &&
      x <= rect.right + 12 &&
      y >= rect.top - 12 &&
      y <= rect.bottom + 12
    );
  };

  const scene = layerRef.current?.scene ?? null;
  const next = scene?.next ?? null;
  const putBack = (entry: BinEntry) => {
    playBinSound("back");
    void store
      .restore(entry.id)
      .then(() => setToast(`${entry.label} is back at its desk.`), report);
  };
  const held = bin.paused && holding;
  const hudElement =
    (edge && (holding || carrying)) || toast || held ? (
      <>
        {held ? (
          // Screen space, at the top: never under the asks rail or past the
          // viewport's edge, wherever the held bus is drawn.
          <section className="town-bus-held" aria-label="Held bus">
            <strong>
              Bus held
              {next
                ? next.leaving
                  ? " on its way out"
                  : ` · ${clock(next.remaining)}`
                : ""}
            </strong>
            <ul>
              {bin.entries.map((entry) => (
                <li key={entry.id}>
                  <span title={entry.label}>{entry.label}</span>
                  <button
                    type="button"
                    aria-label={`Put ${entry.label} back at its desk`}
                    onClick={() => putBack(entry)}
                  >
                    Put back
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="town-bus-go"
              onClick={() => void store.resume().catch(report)}
            >
              Let it go
            </button>
          </section>
        ) : null}
        {edge && (holding || carrying) ? (
          <button
            ref={chip}
            type="button"
            className="town-bus-chip"
            data-carrying={String(carrying)}
            style={{ left: edge.x, top: edge.y }}
            onClick={flyToStop}
            aria-label={
              carrying
                ? "Send to the bus stop"
                : `Bus stop: ${bin.entries.length} waiting. Show the stop`
            }
          >
            <span aria-hidden="true">🚌</span>
            {carrying ? (
              <span>Bus stop</span>
            ) : next ? (
              <span>
                {next.leaving ? "leaving" : clock(next.remaining)} ·{" "}
                {bin.entries.length}
              </span>
            ) : null}
          </button>
        ) : null}
        {toast ? (
          <div className="town-bus-toast" role="status">
            {toast}
          </div>
        ) : null}
      </>
    ) : null;

  const worldElement = (
    <TownBusControls
      scene={scene}
      live={() => layerRef.current?.scene ?? null}
      entries={bin.entries}
      paused={bin.paused}
      remaining={(entry) => store.remaining(entry)}
      onHold={() => void store.pause().catch(report)}
      onRelease={() => void store.resume().catch(report)}
      onPutBack={putBack}
    />
  );

  return {
    town,
    send,
    over,
    setCarrying,
    hudElement,
    worldElement,
  };
}

/**
 * The bus's controls, in world space over the drawn bus: press and hold a
 * bus to stop it with its doors open, Let it go to drive on, and take any
 * rider off (drag it away, or press its button) to send it back. A bus
 * driving away can still be stopped until it leaves the map: its road ahead
 * is one target, hit-tested against the bus as drawn when pressed.
 */
function TownBusControls({
  scene,
  live,
  entries,
  paused,
  remaining,
  onHold,
  onRelease,
  onPutBack,
}: {
  scene: TownBusScene | null;
  /** The scene as last drawn (it moves between React renders). */
  live(): TownBusScene | null;
  entries: readonly BinEntry[];
  paused: boolean;
  remaining(entry: BinEntry): number;
  onHold(): void;
  onRelease(): void;
  onPutBack(entry: BinEntry): void;
}) {
  const holdTimer = useRef<number | null>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  /** A drag that just put a rider back; the click that follows does nothing. */
  const dragged = useRef(false);
  if (!scene || !entries.length) return null;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const front = scene.buses[0];
  const startHold = () => {
    if (paused) return;
    holdTimer.current = window.setTimeout(onHold, 450);
  };
  const stopHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const riderDown = (id: string, event: ReactPointerEvent) => {
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer down: the drag ends on its own.
    }
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
  };
  const riderMove = (event: ReactPointerEvent) => {
    const d = drag.current;
    if (d && Math.hypot(event.clientX - d.x, event.clientY - d.y) > 24)
      d.moved = true;
  };
  const riderUp = (event: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const entry = d && byId.get(d.id);
    dragged.current = Boolean(d?.moved);
    if (entry && d.moved) {
      event.stopPropagation();
      onPutBack(entry);
    }
  };
  /**
   * A press on a bus driving away: a rider under it is taken off (pressed
   * or dragged), anywhere else press and hold stops the bus.
   */
  const roadDown = (left: number, event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const drawn = live();
    const scale = box.width / Math.max(1, event.currentTarget.offsetWidth);
    const id =
      drawn &&
      townBusRiderAt(
        drawn,
        left + (event.clientX - box.left) / scale,
        Number.parseFloat(event.currentTarget.style.top) +
          (event.clientY - box.top) / scale,
      );
    if (id) riderDown(id, event);
    else startHold();
  };
  const roadUp = (event: ReactPointerEvent) => {
    const d = drag.current;
    stopHold();
    if (!d) return;
    drag.current = null;
    const entry = byId.get(d.id);
    dragged.current = true;
    event.stopPropagation();
    if (entry) onPutBack(entry);
  };
  const riders = [
    ...scene.waiting,
    ...scene.buses.filter((bus) => bus.doorsOpen).flatMap((bus) => bus.riders),
  ];
  return (
    <div className="town-bus-controls">
      <div
        className="town-bus-sign"
        style={{ left: scene.stop.x + scene.stop.w / 2, top: scene.stop.y - 4 }}
      >
        {front
          ? front.phase === "departing"
            ? "leaving"
            : clock(front.remaining)
          : null}{" "}
        · {entries.length}
        {paused ? " · held" : ""}
      </div>
      {scene.buses.map((bus) => {
        // Driving in or away: the road it is on (from the map's edge to its
        // stop, or from its stop to the edge), which holds the bus
        // wherever it has got to.
        const moving = bus.phase !== "waiting" && !paused;
        const coming = moving && bus.phase === "arriving";
        const leaving = moving && !coming;
        const left = coming ? 0 : leaving ? bus.home : bus.x;
        return (
          <button
            key={`${bus.trip}:${bus.home}:${bus.y}`}
            type="button"
            className="town-bus-hold"
            data-leaving={String(leaving)}
            data-coming={String(coming)}
            style={{
              left,
              top: bus.y,
              width: coming
                ? bus.home + BUS_W
                : leaving
                  ? Math.max(BUS_W, scene.edge - left)
                  : BUS_W,
              height: BUS_H,
            }}
            aria-label={
              paused
                ? "Bus held with its doors open"
                : coming
                  ? "The bus is coming: press and hold to stop it"
                  : leaving
                    ? "The bus is leaving: press and hold to stop it"
                    : "Press and hold to stop the bus"
            }
            aria-pressed={paused}
            onPointerDown={(event) =>
              moving ? roadDown(left, event) : startHold()
            }
            onPointerMove={riderMove}
            onPointerUp={(event) => (moving ? roadUp(event) : stopHold())}
            onPointerLeave={stopHold}
            onPointerCancel={() => {
              stopHold();
              drag.current = null;
            }}
            // Enter or Space (a click with no pointer) holds or lets go.
            onClick={(event) => {
              if (event.detail !== 0) return;
              if (paused) onRelease();
              else onHold();
            }}
            onContextMenu={(event) => event.preventDefault()}
          />
        );
      })}
      {riders.map((rider) => {
        const entry = byId.get(rider.entryId);
        if (!entry) return null;
        return (
          <button
            key={rider.entryId}
            type="button"
            className="town-bus-rider"
            style={{ left: rider.x - 2, top: rider.y - 2 }}
            title={`${entry.label} · ${clock(remaining(entry))}`}
            aria-label={`Take ${entry.label} off the bus`}
            onPointerDown={(event) => riderDown(rider.entryId, event)}
            onPointerMove={riderMove}
            onPointerUp={riderUp}
            onClick={() => {
              if (dragged.current) dragged.current = false;
              else onPutBack(entry);
            }}
          />
        );
      })}
    </div>
  );
}
