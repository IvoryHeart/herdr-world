import { useLayer } from "../../layerStack";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import {
  BIN_BUS_DRIVE_MS,
  BIN_BUS_INTERVAL_MS,
  type BinView,
} from "../../../../shared/bin";
import type { WorldObject } from "../worldObject";
import { useNow } from "../handoffs";
import {
  BIN_OPEN_EVENT,
  binBlockReason,
  binMatches,
  putInBin,
  sharedBinStore,
  useWorldBin,
} from "./binStore";
import "./bin.css";

export function nextBusText(remaining: number) {
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function BinTray({
  world,
  selectedId,
  view,
}: {
  world: WorldObject;
  selectedId: string | null;
  view: BinView;
}) {
  const bin = useWorldBin();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const trayRef = useRef<HTMLElement>(null);
  useLayer(open, () => setOpen(false), { element: () => trayRef.current });
  useNow(1000);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(BIN_OPEN_EVENT, show);
    return () => window.removeEventListener(BIN_OPEN_EVENT, show);
  }, []);
  const node = selectedId ? world.nodeById.get(selectedId) : null;
  const selected = node?.kind === "agent" ? node : null;
  const held =
    selected &&
    [...bin.entries, ...(bin.closing_entries ?? [])].some((entry) =>
      binMatches(entry, selected),
    );
  const blocked = selected ? binBlockReason(selected, world) : null;
  const elapsed = Math.max(0, performance.now() - bin.readAt);
  const remaining = Math.max(0, (bin.bus?.remaining_ms ?? 0) - elapsed);
  const next = bin.bus?.driving
    ? remaining + BIN_BUS_INTERVAL_MS - BIN_BUS_DRIVE_MS
    : remaining;
  const operate = async (method: string, params: Record<string, unknown>) => {
    setBusy(true);
    try {
      await sharedBinStore().write(method, params);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="world-bin-controls">
        {selected && !held ? (
          <button
            type="button"
            disabled={!!blocked || busy || !bin.verified}
            title={blocked ?? `Hold ${selected.label} for the next bus`}
            onClick={() => void putInBin(selected, world, view)}
          >
            Put in bin
          </button>
        ) : null}
        <button
          type="button"
          data-agent-bin-drop={view === "town" ? "" : undefined}
          title={
            view === "town"
              ? "Drag an agent here to put it in the bin"
              : undefined
          }
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Trash2 size={16} aria-hidden="true" /> Bin {bin.entries.length || ""}
        </button>
      </div>
      {open
        ? createPortal(
            <div className="world-bin-backdrop" onClick={() => setOpen(false)}>
              <section
                ref={trayRef}
                className="world-bin-tray"
                role="dialog"
                aria-modal="true"
                aria-label="Agent bin"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h2>Agent bin</h2>
                  <button
                    type="button"
                    aria-label="Close bin"
                    autoFocus
                    onClick={() => setOpen(false)}
                  >
                    <X size={20} />
                  </button>
                </header>
                <p>
                  {bin.verified
                    ? `Next bus in ${nextBusText(next)} · every 3 minutes`
                    : "Connecting to the bin…"}
                </p>
                <p>
                  Held agents stay open. Put back before boarding, or close now.
                </p>
                {bin.error ? (
                  <p role="alert">
                    {bin.error}{" "}
                    <button
                      type="button"
                      onClick={() => void sharedBinStore().refresh()}
                    >
                      Retry
                    </button>
                  </p>
                ) : null}
                {!bin.entries.length ? (
                  <p>
                    The bin is empty. Select an agent in Town, Board or Desk,
                    then choose Put in bin.
                  </p>
                ) : (
                  <ul>
                    {bin.entries.map((entry) => (
                      <li key={entry.id}>
                        <strong>{entry.label}</strong>
                        <small>
                          {entry.boarded
                            ? "On the bus · closing when it leaves Town"
                            : `Waiting · bus in ${nextBusText(next)}`}
                        </small>
                        <div>
                          <button
                            type="button"
                            disabled={entry.boarded || busy || !bin.verified}
                            onClick={() =>
                              void operate("world.bin.restore", {
                                id: entry.id,
                              })
                            }
                          >
                            Put back
                          </button>
                          <button
                            type="button"
                            disabled={busy || !bin.verified}
                            onClick={() =>
                              void operate("world.bin.close_now", {
                                ids: [entry.id],
                              })
                            }
                          >
                            Close now
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {bin.closing.length ? (
                  <p role="status">Closing {bin.closing.length} agent(s)…</p>
                ) : null}
                {bin.outcomes.slice(-3).map((outcome) => (
                  <p key={outcome.id} role="status">
                    {outcome.label}:{" "}
                    {outcome.result === "closed"
                      ? "closed"
                      : (outcome.detail ?? outcome.result)}
                  </p>
                ))}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
