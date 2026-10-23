import { Crown, Volume2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_CHIMES,
  MOTIFS,
  MOTIF_LABELS,
  TIMBRES,
  TIMBRE_LABELS,
  type ChimeSettings,
  type Motif,
  type Timbre,
} from "../../../shared/chimes";
import {
  type ChimeDevice,
  chimeDevice,
  setChimeDevice,
} from "../chimes/chimeCenter";
import { previewChime } from "../chimes/player";
import { CloseButton } from "../components/CloseButton";
import { useLayer } from "../layerStack";
import {
  profileFor,
  saveChimes,
  setTownMaster,
  useAgentProfiles,
  type TerminalKey,
} from "./agentProfiles";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import "./agentProfiles.css";

const leafName = (leaf: WorldLeafObject) =>
  leaf.agentName ?? leaf.agentLabel ?? leaf.tabLabel ?? leaf.terminalId;
const keyOf = (leaf: WorldLeafObject): TerminalKey => ({
  connection_id: leaf.connectionId,
  terminal_id: leaf.terminalId,
});
const sameKey = (a: TerminalKey | null, leaf: WorldLeafObject) =>
  Boolean(
    a &&
      a.connection_id === leaf.connectionId &&
      a.terminal_id === leaf.terminalId,
  );

/**
 * Settings → Sounds: this device's sound (not synced), the owner's chimes
 * (synced across browsers) and who the Town master is.
 */
export function SoundsDialog({
  world,
  onClose,
}: {
  world: WorldObject;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, () => onClose(), { element: () => ref.current });
  const { document } = useAgentProfiles();
  const chimes = document?.chimes ?? DEFAULT_CHIMES;
  const [device, setDevice] = useState<ChimeDevice>(chimeDevice);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<WorldLeafObject | null>(null);
  const [chosen, setChosen] = useState("");

  const agents = useMemo(
    () => world.leaves.filter((leaf) => leaf.kind === "agent"),
    [world.leaves],
  );
  const holder = document?.town_master ?? null;
  const holderLeaf = agents.find((leaf) => sameKey(holder, leaf)) ?? null;
  // Agents launched from a profile that offers the role, not yet holding it.
  const suggested = agents.filter(
    (leaf) =>
      !sameKey(holder, leaf) &&
      profileFor(document, leaf.connectionId, leaf.terminalId)?.town_master,
  );

  const updateDevice = (next: ChimeDevice) => {
    setDevice(next);
    setChimeDevice(next);
  };
  const write = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const updateChimes = (next: ChimeSettings) => write(() => saveChimes(next));
  const assign = (leaf: WorldLeafObject) => {
    // Moving the role from a live holder asks first.
    if (holder && holderLeaf && !sameKey(holder, leaf)) {
      setMoving(leaf);
      return;
    }
    void write(() => setTownMaster(keyOf(leaf), true));
  };
  const test = (motif: Motif, timbre: Timbre = chimes.timbres.crew) =>
    void previewChime(timbre, motif, device.volume);

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal sounds-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Sounds"
      >
        <div className="modal-head">
          <h2>Sounds</h2>
          <CloseButton onClick={onClose} label="Close sounds" />
        </div>

        <section aria-label="This device">
          <h3>This device</h3>
          <label className="profile-check">
            <input
              type="checkbox"
              checked={device.on}
              onChange={(event) =>
                updateDevice({ ...device, on: event.target.checked })
              }
            />
            Play chimes on this device
          </label>
          <label className="agent-field">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={device.volume}
              onChange={(event) =>
                updateDevice({ ...device, volume: Number(event.target.value) })
              }
            />
          </label>
          <div className="sounds-row">
            {MOTIFS.map((motif) => (
              <button key={motif} type="button" onClick={() => test(motif)}>
                <Volume2 size={13} aria-hidden="true" /> {MOTIF_LABELS[motif]}
              </button>
            ))}
          </div>
          <p className="agent-launcher-note">
            Only this browser. Turn it off on the devices that shouldn't chime.
          </p>
        </section>

        <section aria-label="Chimes">
          <h3>Chimes, on all your devices</h3>
          {(["town_master", "crew"] as const).map((klass) => {
            const other =
              klass === "crew"
                ? chimes.timbres.town_master
                : chimes.timbres.crew;
            return (
              <label key={klass} className="agent-field">
                <span>{klass === "crew" ? "Crew" : "Town master"}</span>
                <span className="profile-chime">
                  <select
                    value={chimes.timbres[klass]}
                    onChange={(event) =>
                      void updateChimes({
                        ...chimes,
                        timbres: {
                          ...chimes.timbres,
                          [klass]: event.target.value as Timbre,
                        },
                      })
                    }
                  >
                    {TIMBRES.filter((timbre) => timbre !== other).map(
                      (timbre) => (
                        <option key={timbre} value={timbre}>
                          {TIMBRE_LABELS[timbre]}
                        </option>
                      ),
                    )}
                  </select>
                  <button
                    type="button"
                    title="Play its needs-you chime"
                    onClick={() => test("needs_you", chimes.timbres[klass])}
                  >
                    <Volume2 size={13} aria-hidden="true" /> Preview
                  </button>
                </span>
              </label>
            );
          })}
          <p className="agent-launcher-note">
            The Town master&apos;s chime is its own; the crew and profiles
            can&apos;t use it. A profile can give its agents their own chime
            (Agent profiles → Look &amp; sound).
          </p>
          {MOTIFS.map((motif) => (
            <label key={motif} className="profile-check">
              <input
                type="checkbox"
                checked={chimes.motifs[motif]}
                onChange={(event) =>
                  void updateChimes({
                    ...chimes,
                    motifs: { ...chimes.motifs, [motif]: event.target.checked },
                  })
                }
              />
              {MOTIF_LABELS[motif]}
            </label>
          ))}
        </section>

        <section aria-label="Town master">
          <h3>Town master</h3>
          {holder ? (
            <p className="sounds-row">
              <Crown size={14} aria-hidden="true" />
              {holderLeaf
                ? `${leafName(holderLeaf)} (${holderLeaf.spaceLabel}) is the Town master.`
                : "The Town master's terminal isn't open now."}
              <button
                type="button"
                onClick={() => void write(() => setTownMaster(null))}
              >
                Clear
              </button>
            </p>
          ) : (
            <p>No Town master.</p>
          )}
          {suggested.map((leaf) => (
            <p key={leaf.id} className="sounds-row">
              Make {leafName(leaf)} ({leaf.spaceLabel}) Town master?
              <button type="button" onClick={() => assign(leaf)}>
                <Crown size={13} aria-hidden="true" /> Make Town master
              </button>
            </p>
          ))}
          {moving ? (
            <p className="sounds-row agent-launcher-login-row">
              Move the Town master from {holderLeaf ? leafName(holderLeaf) : ""}{" "}
              to {leafName(moving)}?
              <button
                type="button"
                onClick={() => {
                  const leaf = moving;
                  setMoving(null);
                  void write(() => setTownMaster(keyOf(leaf), true));
                }}
              >
                Move
              </button>
              <button type="button" onClick={() => setMoving(null)}>
                Cancel
              </button>
            </p>
          ) : null}
          <div className="sounds-row">
            <select
              aria-label="Agent to make Town master"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            >
              <option value="">Choose an agent…</option>
              {agents
                .filter((leaf) => !sameKey(holder, leaf))
                .map((leaf) => (
                  <option key={leaf.id} value={leaf.id}>
                    {leafName(leaf)} · {leaf.spaceLabel}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => {
                const leaf = agents.find(
                  (candidate) => candidate.id === chosen,
                );
                if (leaf) assign(leaf);
                setChosen("");
              }}
            >
              <Crown size={13} aria-hidden="true" /> Make Town master
            </button>
          </div>
          <p className="agent-launcher-note">
            Only you assign it. It names a terminal, so it ends when Herdr
            restarts.
          </p>
        </section>

        <section aria-label="Notes">
          <p className="agent-launcher-note">
            An agent sends you a &ldquo;for you&rdquo; with{" "}
            <code>herdr notification show &lt;title&gt;</code> and no{" "}
            <code>--sound</code>; Herdr doesn&apos;t say which agent sent it, so
            it reads &ldquo;sender unknown&rdquo;.
          </p>
          <p className="agent-launcher-note">
            Herdr&apos;s own terminal client plays its own sound too; turn it
            off with <code>[ui.sound] enabled = false</code> in Herdr&apos;s{" "}
            <code>config.toml</code>.
          </p>
        </section>
        {error ? (
          <p className="agent-launcher-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
