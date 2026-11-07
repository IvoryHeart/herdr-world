import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLayer } from "../../layerStack";
import { store } from "../../store";
import { tabPinsFor } from "../../tabPins";
import type { BinView } from "../../../../shared/bin";
import { tabCardKey } from "../../../../shared/terminalColor";
import { sharedBoardStore } from "../board/boardDocument";
import type { WorldLeafObject, WorldObject } from "../worldObject";
import {
  binAddRequest,
  binBusClock,
  binClockLabel,
  type WorldBin,
} from "./binStore";
import { useWorldBin, worldBinStore } from "./useWorldBin";
import { WORLD_BIN_OPEN_EVENT } from "./worldBinEvents";
import "./bin.css";

/**
 * Put an agent in the bin: it is held, and Town's next bus takes it. A
 * pinned desk (`pinnedDesk`) or a tab pinned in Spaces never loses its last
 * pane. True once held.
 */
export async function putInBin(
  leaf: WorldLeafObject,
  view: BinView,
  pinnedDesk: boolean,
) {
  const error = await worldBinStore().add(
    binAddRequest(leaf, view, pinnedDesk, tabPinsFor(leaf.connectionId)),
  );
  if (error)
    store.notify({
      kind: "error",
      message: `${leaf.label} was not put in the bin`,
      detail: error,
    });
  return !error;
}

/**
 * Put an agent in the bin from a view's drag: its tab is kept when its desk
 * is pinned in Town (by the tab's card key) or its tab in Spaces.
 */
export function putAgentInBin(
  leaf: WorldLeafObject,
  view: BinView,
  world: Pick<WorldObject, "spaces">,
) {
  const workspaceIds = new Set(
    world.spaces
      .filter((space) => space.connectionId === leaf.connectionId)
      .map((space) => space.nativeId),
  );
  const pins = sharedBoardStore().get().document?.layout.desk_pins ?? {};
  const key = tabCardKey(leaf.connectionId, leaf.tabId, workspaceIds);
  return putInBin(leaf, view, Boolean(pins[key]));
}

const OUTCOME: Record<string, string> = {
  closed: "Closed",
  gone: "Not closed",
  refused: "Not closed",
  uncertain: "May have closed",
};

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
 * The bin in every view: a chip while it holds agents (always in Town and on
 * Board, where agents are dragged onto it), and its tray (from the chip, or
 * Town's stops and bus) listing who waits with the time to the next bus,
 * with Put back and Close now. A stopped bus is let go from the tray, or
 * goes on as the tray closes.
 */
export function WorldBin({ always = false }: { always?: boolean }) {
  const bin = useWorldBin();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = bin.entries.length + bin.closing.length;
  const now = useSecondClock(open || held > 0);
  const tray = useRef<HTMLElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  useLayer(open, () => setOpen(false), {
    element: () => tray.current,
    anchors: () => [chip.current],
  });
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(WORLD_BIN_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WORLD_BIN_OPEN_EVENT, onOpen);
  }, []);
  // A bus stopped from Town opens the tray; closing the tray lets it go on.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (!open) setError(null);
    if (wasOpen.current && !open && worldBinStore().get().bus.stopped)
      void worldBinStore().goBus();
    wasOpen.current = open;
  }, [open]);
  const act = (run: () => Promise<string | null>) =>
    void run().then((failed) => setError(failed));
  const bus = busLabel(bin, now);
  if (!held && !open && !always) return null;
  return (
    <>
      {held || always ? (
        <button
          ref={chip}
          type="button"
          className="world-bin-chip"
          // Drag an agent here to put it in the bin (Town and Board).
          data-bin-drop=""
          data-empty={held ? undefined : ""}
          aria-expanded={open}
          aria-label={
            held
              ? `Bin, ${held} ${held === 1 ? "agent" : "agents"}, ${bus}`
              : "Bin, empty"
          }
          title="Drag an agent here to put it in the bin"
          onClick={() => setOpen((value) => !value)}
        >
          <Trash2 size={15} aria-hidden="true" />
          {held ? (
            <>
              <b>{held}</b>
              <span>{bus}</span>
            </>
          ) : null}
        </button>
      ) : null}
      {open ? (
        <section
          ref={tray}
          className="world-bin-tray"
          role="dialog"
          aria-label="Bin"
        >
          <header>
            <strong>Bin</strong>
            <span>{bus}</span>
            {bin.bus.stopped ? (
              <button
                type="button"
                className="world-bin-go"
                onClick={() => act(() => worldBinStore().goBus())}
              >
                Let the bus go
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Close the bin"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          {held ? (
            <ul>
              {bin.entries.map((entry) => (
                <li key={entry.id} data-bin-entry={entry.id}>
                  <span>
                    <b>{entry.label}</b>
                    <small>
                      {entry.riding
                        ? "On the bus; closes when it leaves"
                        : "Waiting for the bus"}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => act(() => worldBinStore().restore(entry.id))}
                  >
                    Put back
                  </button>
                  <button
                    type="button"
                    className="world-bin-close-now"
                    onClick={() =>
                      act(() => worldBinStore().closeNow([entry.id]))
                    }
                  >
                    Close now
                  </button>
                </li>
              ))}
              {bin.closing.map((entry) => (
                <li key={entry.id} data-bin-entry={entry.id}>
                  <span>
                    <b>{entry.label}</b>
                    <small>Closing…</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="world-bin-empty">
              The bin is empty. Drag an agent onto the bin or a bus stop, or use
              its window's ⋯ menu.
            </p>
          )}
          {error ? (
            <p className="world-bin-error" role="alert">
              {error}
            </p>
          ) : null}
          {bin.outcomes.length ? (
            <ol className="world-bin-outcomes" aria-label="Recent">
              {bin.outcomes
                .slice(-3)
                .reverse()
                .map((outcome) => (
                  <li key={outcome.id} data-result={outcome.result}>
                    <b>{outcome.label}</b> {OUTCOME[outcome.result]}
                    {outcome.result !== "closed" && outcome.detail
                      ? `: ${outcome.detail}`
                      : ""}
                  </li>
                ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function busLabel(bin: WorldBin, now: number) {
  if (!bin.verified) return "bin unavailable";
  const { elapsed, next } = binBusClock(bin, now);
  if (elapsed !== null && bin.bus.stopped) return "bus stopped";
  return elapsed !== null ? "bus on its way" : `bus in ${binClockLabel(next)}`;
}
