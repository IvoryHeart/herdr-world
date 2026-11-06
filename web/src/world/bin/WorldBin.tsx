import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLayer } from "../../layerStack";
import { store } from "../../store";
import { tabPinsFor } from "../../tabPins";
import type { BinView } from "../../../../shared/bin";
import type { WorldLeafObject } from "../worldObject";
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
 * The bin in every view: a chip while it holds agents, and its tray (from
 * the chip, or Town's stops and bus) listing who waits with the time to the
 * next bus, with Put back and Close now.
 */
export function WorldBin() {
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
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);
  const act = (run: () => Promise<string | null>) =>
    void run().then((failed) => setError(failed));
  const bus = busLabel(bin, now);
  if (!held && !open) return null;
  return (
    <>
      {held ? (
        <button
          ref={chip}
          type="button"
          className="world-bin-chip"
          aria-expanded={open}
          aria-label={`Bin, ${held} ${held === 1 ? "agent" : "agents"}, ${bus}`}
          onClick={() => setOpen((value) => !value)}
        >
          <Trash2 size={15} aria-hidden="true" />
          <b>{held}</b>
          <span>{bus}</span>
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
                        ? "Taken by this bus"
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
              The bin is empty. Put an agent in from its window's ⋯ menu.
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
  return elapsed !== null ? "bus on its way" : `bus in ${binClockLabel(next)}`;
}
