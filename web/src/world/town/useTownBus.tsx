import {
  Fragment,
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
import { WorldBinTray } from "../bin/WorldBinTray";
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
import { townBusChipStop, soonestTownBus } from "./townBusChip";
import { townStopRooms } from "./townBusStop";
import type { TownLayout } from "./townLayout";
import type { TownMoveResult } from "./townMoves";
import type { TownRendererHandle } from "./townRenderer";
import "./townBus.css";

type Point = { x: number; y: number };
/**
 * The carrying chip's centre below the free area's top: it sits in the top
 * edge-pan band, a strip a carry cannot drop on anyway, so it hides little
 * of the town; the band does not pan over or near it (CHIP_NEAR).
 */
const CHIP_DROP_TOP = 44;
/** How near the chip, screen px, a carry holds the town still. */
const CHIP_NEAR = 32;
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

/** That stop, its sign and the bus standing beside it, in screen pixels. */
const stopBox = (
  camera: TownCamera,
  l: TownLayout,
  scene: TownBusScene | null | undefined,
  entries: readonly BinEntry[],
  remaining: (entry: BinEntry) => number,
): ScreenRect => {
  const { pole, foot } = townBusChipStop(l, scene, entries, remaining);
  const a = camera.toScreen(pole - STOP_W / 2 - BUS_W - 4, foot - STOP_H - 16);
  const b = camera.toScreen(pole + STOP_W, foot + 2 + BUS_H);
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
    () => binnedAgents(projection, store.activeTargets()),
    [projection, bin.entries, bin.closing, bin.reservations, store],
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
  /** World controls listening for each drawn frame (they re-render alone). */
  const drawnListeners = useRef(new Set<() => void>());
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer) return;
    const layer = new TownBusLayer({
      layout: () => layoutRef.current(),
      entries: () => latest.current.bin.entries,
      remaining: (entry) => store.remaining(entry),
      elapsed: (entry) => store.elapsed(entry),
      paused: () => latest.current.bin.paused,
      agent: (id) => latest.current.riders.get(id),
      roomOf: (id) => latest.current.riders.get(id)?.roomKey,
      onDrawn: () => {
        for (const listener of drawnListeners.current) listener();
      },
      onArrive: () => playBinSound("horn"),
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
    const drop = binDropOfAgent(
      projection,
      agentKey,
      "town",
      store.reservedTargets(),
    );
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
    if (!next && chip.current) delete chip.current.dataset.over;
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
        if (carried) {
          // Carrying, the chip is the drop target: top centre of the free
          // town, below the edge-pan band, away from the thumb's resting
          // place and the system's bottom gestures, wherever the stop is.
          setEdge({
            x: Math.round((free.left + free.right) / 2 / 4) * 4,
            y: Math.round((free.top + CHIP_DROP_TOP) / 4) * 4,
          });
          return;
        }
        const box = stopBox(
          camera,
          l,
          layerRef.current?.scene,
          latest.current.bin.entries,
          (entry) => store.remaining(entry),
        );
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
    const box = stopBox(
      camera,
      l,
      layerRef.current?.scene,
      latest.current.bin.entries,
      (entry) => store.remaining(entry),
    );
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

  /**
   * A carry at this canvas point is near the chip (never pans the town).
   */
  const near = (at: Point) => {
    const rect = chip.current?.getBoundingClientRect();
    const host = chip.current?.parentElement?.getBoundingClientRect();
    if (!rect || !host) return false;
    const x = at.x + host.left,
      y = at.y + host.top;
    return (
      x >= rect.left - CHIP_NEAR &&
      x <= rect.right + CHIP_NEAR &&
      y >= rect.top - CHIP_NEAR &&
      y <= rect.bottom + CHIP_NEAR
    );
  };

  /**
   * A carried agent at this point is over the stop, its buses or the chip.
   * The chip takes a drop within its visible face only (never the floor
   * around it); under the finger it grows and lights up, with a light buzz
   * where the device has one.
   */
  const over = (world: Point, at: Point) => {
    const scene = layerRef.current?.scene;
    const onStop = Boolean(scene && inTownBusDropZone(scene, world.x, world.y));
    const element = chip.current;
    const rect = element?.getBoundingClientRect();
    const host = element?.parentElement?.getBoundingClientRect();
    let onChip = false;
    if (element && rect && host) {
      const x = at.x + host.left,
        y = at.y + host.top;
      onChip =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (onChip !== (element.dataset.over === "true")) {
        element.dataset.over = String(onChip);
        if (onChip) navigator.vibrate?.(12);
      }
    }
    return onStop || onChip;
  };

  const scene = layerRef.current?.scene ?? null;
  /** "Main stop", or the stop named after its nearest room. */
  const stopName = (entryId: string) => {
    const l = layout();
    const stop = scene?.stopOf.get(entryId);
    const at = stop ? scene?.stops.find((s) => s.id === stop) : undefined;
    if (!l || !at) return null;
    if (at.main) return "at the main stop";
    const room = townStopRooms(l).get(at.id);
    const label = projection.rooms.find((r) => r.key === room)?.displayLabel;
    return label ? `at the stop by ${label}` : "at a bus stop";
  };
  const next = soonestTownBus(bin.entries, (entry) => store.remaining(entry));
  const putBack = (entry: BinEntry) => {
    playBinSound("back");
    void store
      .restore(entry.id)
      .then(() => setToast(`${entry.label} is back at its desk.`), report);
  };
  const held = bin.paused && holding;
  /** Open the common tray: it holds the countdown until it is shut. */
  const openTray = () => {
    if (!holding || bin.paused) return;
    void store.pause().catch(report);
  };
  const hudElement =
    (edge && (holding || carrying)) || toast || held ? (
      <>
        {held ? (
          <WorldBinTray
            entries={bin.entries}
            paused={bin.paused}
            timeLeft={(entry) => store.remaining(entry)}
            onShut={() => void store.resume().catch(report)}
            onPutBack={(entry) => putBack(entry)}
            place={(entry) => stopName(entry.id)}
            onCloseNow={(ids) => {
              if (!bin.verified)
                return report("The bin is reconnecting; try again.");
              void store.closeNow(ids).catch(report);
            }}
            className="town-bus-held"
          />
        ) : null}
        {edge && (holding || carrying) ? (
          <button
            ref={chip}
            type="button"
            className="town-bus-chip"
            data-carrying={String(carrying)}
            style={{ left: edge.x, top: edge.y }}
            onClick={() => {
              // The same tray as tapping the bus, and the bus in view.
              openTray();
              flyToStop();
            }}
            aria-label={
              carrying
                ? "Send to the bus stop"
                : `Bus stop: ${bin.entries.length} waiting. Open the bin tray`
            }
          >
            <span aria-hidden="true">🚌</span>
            {carrying ? (
              <span>
                Bus stop
                <small>drop to close</small>
              </span>
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
      onDrawn={(listener) => {
        drawnListeners.current.add(listener);
        return () => drawnListeners.current.delete(listener);
      }}
      entries={bin.entries}
      paused={bin.paused}
      remaining={(entry) => store.remaining(entry)}
      onHold={openTray}
      onPutBack={putBack}
    />
  );

  return {
    town,
    send,
    over,
    near,
    setCarrying,
    hudElement,
    worldElement,
  };
}

/** What the world controls show of a scene: change it and they re-render. */
const controlsKey = (scene: TownBusScene) =>
  [
    ...scene.buses.map(
      (bus) =>
        `${bus.key}:${Math.round(bus.x)}:${bus.y}:${bus.phase}:${bus.doorsOpen}:${Math.round(bus.elapsed / 50)}:${bus.riders.length}`,
    ),
    ...scene.stops.map(
      (stop) => `${stop.id}:${stop.riders}:${stop.waiting.length}`,
    ),
  ].join("|");

/**
 * The bus's controls in world space: a tap opens the common held tray,
 * Resume drives on, and dragging a rider away sends it back. A bus
 * driving away can still be stopped until it leaves the map: its road ahead
 * is one target, hit-tested against the bus as drawn when pressed.
 */
function TownBusControls({
  scene: rendered,
  live,
  onDrawn,
  entries,
  paused,
  remaining,
  onHold,
  onPutBack,
}: {
  scene: TownBusScene | null;
  /** The scene as last drawn (it moves between React renders). */
  live(): TownBusScene | null;
  /** Listen for each drawn frame; returns the unsubscribe. */
  onDrawn(listener: () => void): () => void;
  entries: readonly BinEntry[];
  paused: boolean;
  remaining(entry: BinEntry): number;
  onHold(): void;
  onPutBack(entry: BinEntry): void;
}) {
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  /** A drag that just put a rider back; the click that follows does nothing. */
  const dragged = useRef(false);
  // Follow the bus as drawn, frame by frame: only this component re-renders,
  // and only when what it shows (a bus's place, phase or clock) changed.
  const [, redraw] = useState(0);
  const shown = useRef("");
  const subscribe = useRef(onDrawn);
  subscribe.current = onDrawn;
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(
    () =>
      subscribe.current(() => {
        const drawn = liveRef.current();
        const key = drawn ? controlsKey(drawn) : "";
        if (key === shown.current) return;
        shown.current = key;
        redraw((n) => n + 1);
      }),
    [],
  );
  const scene = live() ?? rendered;
  if (!scene || !entries.length) return null;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const soon = soonestTownBus(entries, remaining);
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
    if (d?.moved)
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
    if (entry && d.moved) {
      event.stopPropagation();
      onPutBack(entry);
    }
  };
  /**
   * A press on a bus driving away: a rider under it is taken off (pressed
   * for a drag); a simple tap opens the tray.
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
    else drag.current = null;
  };
  const roadUp = (event: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const entry = d && byId.get(d.id);
    if (entry && d.moved) {
      dragged.current = true;
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
      event.stopPropagation();
      onPutBack(entry);
    }
  };
  const riders = [
    ...scene.waiting,
    ...scene.buses.filter((bus) => bus.doorsOpen).flatMap((bus) => bus.riders),
  ];
  return (
    <div className="town-bus-controls">
      {scene.stops.map((stop) => {
        // Every stop has a sign; the main one and those with riders show the
        // shared countdown, the rest just their name.
        const shown = stop.main || stop.riders > 0;
        const centre = stop.box.x + stop.box.w / 2;
        return (
          <Fragment key={stop.id}>
            {shown ? (
              <div
                className="town-bus-sign"
                data-stop={stop.id}
                data-main={String(stop.main)}
                style={{ left: centre, top: stop.box.y - 4 }}
              >
                {soon
                  ? soon.leaving
                    ? "leaving"
                    : clock(soon.remaining)
                  : null}{" "}
                · {stop.riders || entries.length}
                {paused ? " · held" : ""}
              </div>
            ) : null}
            {/* Any stop and its sign open the same tray as the bus. */}
            <button
              type="button"
              className="town-bus-stop"
              data-stop={stop.id}
              data-main={String(stop.main)}
              style={{
                left: centre,
                top: stop.box.y + stop.box.h,
                height: stop.box.h,
              }}
              aria-label={`${stop.main ? "Main bus stop" : "Bus stop"}: ${stop.riders} waiting here, ${entries.length} in the bin. Open the bin tray`}
              onClick={onHold}
            />
          </Fragment>
        );
      })}
      {scene.buses.map((bus) => {
        // Driving in or away: a stretch of its street around it, which holds
        // the bus wherever it has got to.
        const moving = bus.phase !== "waiting" && !paused;
        const coming = moving && bus.phase === "arriving";
        const leaving = moving && !coming;
        const left = moving ? Math.max(0, bus.x - BUS_W) : bus.x;
        return (
          <button
            key={bus.key}
            type="button"
            className="town-bus-hold"
            data-phase={bus.phase}
            data-trip-elapsed={bus.elapsed}
            data-leaving={String(leaving)}
            data-coming={String(coming)}
            style={{
              left,
              top: bus.y,
              width: moving
                ? Math.max(
                    BUS_W,
                    Math.min(scene.edge, bus.x + 2 * BUS_W) - left,
                  )
                : BUS_W,
              height: BUS_H,
            }}
            aria-label={
              paused
                ? "Bus held with its doors open"
                : coming
                  ? "The bus is coming: open bin tray"
                  : leaving
                    ? "The bus is leaving: open bin tray"
                    : "Open bin tray"
            }
            aria-pressed={paused}
            onPointerDown={(event) =>
              moving ? roadDown(left, event) : undefined
            }
            onPointerMove={riderMove}
            onPointerUp={(event) => (moving ? roadUp(event) : undefined)}
            onPointerCancel={() => {
              drag.current = null;
            }}
            // A normal tap, click, Enter or Space opens the shared held tray.
            onClick={(event) => {
              if (dragged.current && event.detail !== 0) {
                dragged.current = false;
                return;
              }
              dragged.current = false;
              onHold();
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
              else onHold();
            }}
          />
        );
      })}
    </div>
  );
}
