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
import { inTownBusDropZone, type TownBusScene } from "./scene/townBus";
import type { TownHud } from "./scene/townHud";
import type { TownSceneCamera } from "./scene/townSceneCamera";
import { BUS_H, BUS_W } from "./townBusGeometry";
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
  view,
  hud,
}: {
  projection: HerdrOfficeProjection;
  /** The town as drawn (it is laid out from the projection this returns). */
  layout(): TownLayout | null;
  ready: boolean;
  rendererRef: RefObject<TownRendererHandle | null>;
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
  const [edge, setEdge] = useState<Point | null>(null);
  const [carrying, setCarrying] = useState(false);
  useEffect(
    () =>
      hud().onFrame(() => {
        // A carry shows the drag ghost; its absence ends a carry for sure.
        setCarrying(document.querySelector(".town-drag-ghost") !== null);
        const camera = view.camera;
        const l = layout();
        if (!camera || !l) return;
        const stop = camera.toScreen(
          l.busStop.x * 16 + 8,
          l.busStop.y * 16 - 8,
        );
        const { width, height, inset } = camera.viewport;
        // Keep the whole chip on screen (it is centred on this point).
        const padX = 72,
          padY = 32;
        const inside =
          stop.x > inset.left &&
          stop.x < width - inset.right &&
          stop.y > inset.top &&
          stop.y < height - inset.bottom;
        const next = inside
          ? null
          : {
              x:
                Math.round(
                  Math.min(
                    width - inset.right - padX,
                    Math.max(inset.left + padX, stop.x),
                  ) / 4,
                ) * 4,
              y:
                Math.round(
                  Math.min(
                    // On a phone the rail of asks fills the lower part.
                    width < 600
                      ? Math.min(height - inset.bottom - padY, height * 0.55)
                      : height - inset.bottom - padY,
                    Math.max(inset.top + padY, stop.y),
                  ) / 4,
                ) * 4,
            };
        setEdge((current) =>
          current?.x === next?.x && current?.y === next?.y ? current : next,
        );
      }),
    [hud, view, layout],
  );
  const flyToStop = () => {
    const camera = view.camera;
    const l = layout();
    if (!camera || !l) return;
    camera.flyTo(l.busStop.x * 16, l.busStop.y * 16, camera.z, 0.6);
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
            <strong>Bus held{next ? ` · ${clock(next.remaining)}` : ""}</strong>
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
                {clock(next.remaining)} · {bin.entries.length}
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
 * rider off (drag it away, or press its button) to send it back.
 */
function TownBusControls({
  scene,
  entries,
  paused,
  remaining,
  onHold,
  onRelease,
  onPutBack,
}: {
  scene: TownBusScene | null;
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
    event.currentTarget.setPointerCapture(event.pointerId);
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
        {front ? clock(front.remaining) : null} · {entries.length}
        {paused ? " · held" : ""}
      </div>
      {scene.buses
        .filter((bus) => bus.phase === "waiting" || paused)
        .map((bus) => (
          <button
            key={`${bus.trip}:${bus.x}:${bus.y}`}
            type="button"
            className="town-bus-hold"
            style={{ left: bus.x, top: bus.y, width: BUS_W, height: BUS_H }}
            aria-label={
              paused
                ? "Bus held with its doors open"
                : "Press and hold to stop the bus"
            }
            aria-pressed={paused}
            onPointerDown={startHold}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            // Enter or Space (a click with no pointer) holds or lets go.
            onClick={(event) => {
              if (event.detail !== 0) return;
              if (paused) onRelease();
              else onHold();
            }}
            onContextMenu={(event) => event.preventDefault()}
          />
        ))}
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
