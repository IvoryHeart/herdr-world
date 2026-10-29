import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BinEntry } from "../../../../shared/bin";
import {
  addToBin,
  binOutcomeText,
  onBinOutcome,
  pauseBin,
  restoreFromBin,
  resumeBin,
  useWorldBin,
} from "../bin/binStore";
import { playBinSound } from "../bin/binSounds";
import { binCandidate, type BinCandidate } from "../bin/binTargets";
import { TownBusLayer } from "./townBusLayer";
import "./townBus.css";
import type { TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";

const TOWN_BUS_STOP_EVENT = "herdr-world:town-bus-stop";
/** The visible twin of dragging an agent to the stop (the Town peek's button). */
export function sendToBusStop(agentKey: string) {
  window.dispatchEvent(
    new CustomEvent<string>(TOWN_BUS_STOP_EVENT, { detail: agentKey }),
  );
}

export type TownBus = {
  layer: TownBusLayer;
  /** What the bus would take for an agent, and why it can't, if it can't. */
  candidate(agentKey: string): BinCandidate | null;
  /** Send an agent to the stop (or say why not). */
  drop(agentKey: string): void;
  hold(): void;
  release(): void;
  /** A passenger dragged off the bus goes back to their desk. */
  restore(entry: BinEntry): void;
};

/**
 * Town's side of the bin: the bus layer over the town, kept in step with the
 * service's bin and the town model. Agents dropped at the stop catch the bus
 * that is boarding, or wait for the next one.
 */
export function useTownBus(
  rendererRef: RefObject<TownRendererHandle | null>,
  ready: boolean,
  model: TownModel,
  layout: TownLayout,
) {
  const current = useWorldBin();
  const [receipt, setReceipt] = useState<string | null>(null);
  const layer = useMemo(
    () => new TownBusLayer(() => rendererRef.current?.invalidate("bus")),
    [rendererRef],
  );
  const latest = useRef({ model, current });
  latest.current = { model, current };

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer) return;
    renderer.setOverlay(layer);
    return () => {
      try {
        renderer.setOverlay(null);
      } catch {
        // The renderer was destroyed first.
      }
    };
  }, [ready, rendererRef, layer]);
  useEffect(() => () => layer.dispose(), [layer]);

  useEffect(() => layer.setLayout(layout), [layer, layout]);

  useEffect(() => {
    const agentOf = new Map<string, string>();
    for (const entry of current.bin.entries)
      for (const agent of model.agents.values()) {
        const pane = agent.currentPaneRef;
        if (
          pane.connectionId === entry.connection_id &&
          pane.generation === entry.connection_generation &&
          pane.nativeId === entry.pane_id
        ) {
          agentOf.set(entry.id, agent.key);
          break;
        }
      }
    layer.setBin(current, agentOf);
  }, [layer, current, model]);

  useEffect(
    () =>
      onBinOutcome((outcome) => {
        if (outcome.result === "closed") playBinSound("close");
        setReceipt(
          outcome.result === "closed"
            ? `${binOutcomeText(outcome)} The bus left town.`
            : binOutcomeText(outcome),
        );
      }),
    [],
  );
  useEffect(() => {
    if (!receipt) return;
    const timer = window.setTimeout(() => setReceipt(null), 3600);
    return () => window.clearTimeout(timer);
  }, [receipt]);

  const report = (error: unknown) =>
    setReceipt(error instanceof Error ? error.message : String(error));

  const bus = useMemo<TownBus>(() => {
    const candidate = (agentKey: string) => {
      const m = latest.current.model;
      const agent = m.agents.get(agentKey);
      if (!agent) return null;
      const room = m.rooms.get(agent.roomKey);
      const desk = agent.deskKey ? m.desks.get(agent.deskKey) : undefined;
      return binCandidate(
        {
          connectionId: agent.currentPaneRef.connectionId,
          generation: agent.currentPaneRef.generation,
          workspaceId: room?.workspaceRef.nativeId ?? "",
          tabId: agent.currentTabRef.nativeId,
          paneId: agent.currentPaneRef.nativeId,
          terminalId: agent.currentTerminalRef.nativeId,
          label: agent.agentName || agent.displayLabel,
          unreachable: agent.stale || !agent.canOpenInSpaces || !room,
          working: agent.semanticStatus === "working",
          tabPanes: desk?.paneDevices.length ?? 1,
        },
        "town",
      );
    };
    return {
      layer,
      candidate,
      drop(agentKey) {
        const next = candidate(agentKey);
        if (!next) return;
        if (next.drag.refusal) {
          playBinSound("refuse");
          setReceipt(`${next.drag.refusal}.`);
          return;
        }
        playBinSound("drop");
        void addToBin({ ...next.target, join: layer.joinable() }).then(
          () =>
            setReceipt(
              `${next.drag.label} is waiting for the bus. Press and hold the bus to stop it.`,
            ),
          report,
        );
      },
      hold() {
        if (!latest.current.current.bin.entries.length) return;
        layer.hold();
        playBinSound("back");
        // A pause the service refuses lets the bus go again.
        void pauseBin().catch((error: unknown) => {
          layer.release();
          report(error);
        });
      },
      release() {
        layer.release();
        void resumeBin().catch(report);
      },
      restore(entry) {
        playBinSound("back");
        void restoreFromBin(entry.id).then(() => {
          setReceipt(`${entry.label} is back at their desk.`);
          // An empty bus leaves at once; a held one with passengers stays held.
          if (!latest.current.current.bin.entries.length) layer.release();
        }, report);
      },
    };
  }, [layer]);

  useEffect(() => {
    const listener = (event: Event) =>
      bus.drop((event as CustomEvent<string>).detail);
    window.addEventListener(TOWN_BUS_STOP_EVENT, listener);
    return () => window.removeEventListener(TOWN_BUS_STOP_EVENT, listener);
  }, [bus]);

  return { bus, receipt, current };
}

/** The timetable over the stop, the held bus's control and the latest receipt. */
export function TownBusChrome({
  bus,
  receipt,
}: {
  bus: TownBus;
  receipt: string | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, []);
  const table = bus.layer.timetable();
  return (
    <>
      <div
        className="town-bus-timetable"
        hidden={!table.visible}
        data-x={Math.round(table.x)}
        data-y={Math.round(table.y)}
        data-bus={table.bus || undefined}
        style={{ transform: `translate(${table.x}px, ${table.y}px)` }}
      >
        {table.text}
      </div>
      {bus.layer.held && table.visible ? (
        <div className="town-bus-held" role="group" aria-label="Bus held">
          <span>The bus is held with its doors open.</span>
          <button type="button" onClick={() => bus.release()}>
            Let it go
          </button>
        </div>
      ) : null}
      {receipt ? (
        <div className="town-bus-receipt" role="status">
          {receipt}
        </div>
      ) : null}
    </>
  );
}
