import { Copy, LogIn, Play, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  agentNameFor,
  fillBrief,
  type AgentProfile,
} from "../../../shared/agentProfile";
import { CloseButton } from "../components/CloseButton";
import { useLayer } from "../layerStack";
import {
  harnessLabel,
  launchAgent,
  launcherCatalog,
  readinessNote,
  retainedOutcome,
  openHarnessLogin,
  useAgentProfiles,
  type LaunchTarget,
  type RetainedOutcome,
  type LauncherCatalog,
} from "./agentProfiles";
import { HarnessReadinessSummary } from "./HarnessReadinessSummary";
import { ProfileSprite } from "./ProfileSprite";
import type { WorldObject } from "./worldObject";
import "./agentProfiles.css";

/**
 * New agent: pick a room, optionally say what to do, then tap a profile or a
 * kind. The service creates the tab, starts the harness, waits until it is
 * ready and sends the first prompt (agent/launch.ts).
 */
export function AgentLauncherDialog({
  world,
  initial,
  onOpen,
  onEditProfiles,
  onClose,
}: {
  world: WorldObject;
  initial: Partial<LaunchTarget> & { profileId?: string };
  /** Open this terminal (a new agent or a login) once World shows it. */
  onOpen(terminal: { connectionId: string; terminalId: string }): void;
  onEditProfiles(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, () => onClose(), { element: () => ref.current });
  const { document } = useAgentProfiles();
  const profiles = document?.profiles ?? [];
  const rooms = useMemo(
    () => world.spaces.filter((space) => space.actionable && !space.stale),
    [world.spaces],
  );
  const preferred = initial.profileId
    ? profiles.find((p) => p.id === initial.profileId)
    : undefined;
  const [roomId, setRoomId] = useState<string>(() => {
    const exact = rooms.find(
      (space) =>
        space.connectionId === initial.connectionId &&
        space.nativeId === initial.workspaceId,
    );
    const home = preferred?.home_room
      ? rooms.find((space) => space.label === preferred.home_room)
      : undefined;
    return (exact ?? home ?? rooms[0])?.id ?? "";
  });
  const room = rooms.find((space) => space.id === roomId) ?? null;
  const target: LaunchTarget | null = room && {
    connectionId: room.connectionId,
    generation: room.generation,
    workspaceId: room.nativeId,
    workspaceLabel: room.label,
  };
  const [task, setTask] = useState("");
  const [catalog, setCatalog] = useState<LauncherCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RetainedOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectionId = room?.connectionId;
  const generation = room?.generation;
  const workspaceId = room?.nativeId;
  useEffect(() => {
    if (!connectionId || generation === undefined || !workspaceId) return;
    let current = true;
    setCatalog(null);
    setCatalogError(null);
    launcherCatalog({ connectionId, generation, workspaceId })
      .then((next) => current && setCatalog(next))
      .catch(
        (cause: unknown) =>
          current &&
          setCatalogError(
            cause instanceof Error ? cause.message : String(cause),
          ),
      );
    return () => {
      current = false;
    };
  }, [connectionId, generation, workspaceId, checks]);

  const launch = async (choice: { profile?: AgentProfile; kind?: string }) => {
    if (!target || busy) return;
    const profile = choice.profile;
    const label = profile?.name ?? harnessLabel(choice.kind ?? "");
    const trimmed = task.trim();
    const text = profile
      ? profile.send_brief && (trimmed || !profile.brief.includes("{{task}}"))
        ? fillBrief(profile.brief, {
            name: agentNameFor(profile.name),
            task: trimmed,
            room: target.workspaceLabel,
            spawned_by: "you",
          })
        : trimmed
      : trimmed;
    setBusy(label);
    setOutcome(null);
    setError(null);
    try {
      const result = await launchAgent(target, {
        profileId: profile?.id,
        kind: choice.kind,
        label,
        text,
      });
      // A ready agent opens and the dialog closes; anything else stays
      // here with its reason and a way to open the tab.
      if (
        (result.status === "sent" || result.status === "started") &&
        result.terminal_id
      ) {
        onOpen({
          connectionId: target.connectionId,
          terminalId: result.terminal_id,
        });
        onClose();
        return;
      }
      setOutcome(retainedOutcome(target, result));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const logIn = async (kind: string) => {
    if (!target) return;
    setOutcome(null);
    setError(null);
    try {
      // World types nothing into the tab; the user runs the command there.
      const opened = await openHarnessLogin(target, kind);
      setOutcome(
        retainedOutcome(target, {
          status: "opened",
          message: `A login tab for ${harnessLabel(kind)} is open in ${target.workspaceLabel}. Run this there, finish the login, then Check again:`,
          terminal_id: opened.terminal_id,
          command: opened.command,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // One Log in per harness that needs it, opening its own login command.
  const loggedOut = (catalog?.readiness ?? [])
    .filter((ready) => ready.logged_in === false && ready.can_log_in)
    .map((ready) => ready.kind);
  // Kinds this host has (or may have: no readiness for it); the rest of
  // Herdr's supported kinds are not offered here.
  const quickKinds = (catalog?.kinds ?? []).filter(
    (kind) => !readinessNote(kind, catalog)?.blocked,
  );

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal agent-launcher"
        role="dialog"
        aria-modal="true"
        aria-label="New agent"
      >
        <div className="modal-head">
          <h2>New agent</h2>
          <CloseButton onClick={onClose} label="Close new agent" />
        </div>
        {rooms.length === 0 ? (
          <p className="agent-launcher-note">
            Connect a host and create a room first.
          </p>
        ) : (
          <>
            <label className="agent-field">
              <span>Room</span>
              <select
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
              >
                {rooms.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.label} · {space.hostLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="agent-field">
              <span>Task (optional)</span>
              <textarea
                value={task}
                rows={2}
                placeholder="What should it do? It fills {{task}} in the profile's brief."
                onChange={(event) => setTask(event.target.value)}
              />
            </label>
            {loggedOut.map((kind) => (
              <p key={kind} className="agent-launcher-login-row">
                {harnessLabel(kind)} is logged out on this host.
                <button
                  type="button"
                  className="agent-launcher-login"
                  title={`Opens a tab and shows ${harnessLabel(kind)}'s login command to run there`}
                  onClick={() => void logIn(kind)}
                >
                  <LogIn size={13} aria-hidden="true" /> Log in
                </button>
              </p>
            ))}
            <div className="agent-launcher-section-head">
              <h3>From a profile</h3>
              <button type="button" onClick={onEditProfiles}>
                <Settings2 size={13} aria-hidden="true" /> Edit profiles
              </button>
            </div>
            <div className="agent-launcher-profiles">
              {profiles.map((profile) => {
                const note = readinessNote(profile.harness, catalog);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className="agent-launcher-card"
                    disabled={Boolean(busy) || !catalog || note?.blocked}
                    title={note?.text ?? `Start ${profile.name} here`}
                    aria-label={`Start ${profile.name}`}
                    onClick={() => void launch({ profile })}
                  >
                    <ProfileSprite look={profile.look} scale={2} />
                    <span>
                      <b>{profile.name}</b>
                      <small>
                        {harnessLabel(profile.harness)}
                        {profile.model ? ` · ${profile.model}` : ""}
                      </small>
                      {note ? <em>{note.text}</em> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="agent-launcher-section-head">
              <h3>Quick start</h3>
              <button
                type="button"
                title="Check installed harnesses and logins again"
                onClick={() => setChecks((n) => n + 1)}
              >
                <RefreshCw size={13} aria-hidden="true" /> Check again
              </button>
            </div>
            {catalog ? <HarnessReadinessSummary catalog={catalog} /> : null}
            <div className="agent-launcher-kinds">
              {!catalog && !catalogError ? (
                <span className="agent-launcher-note">
                  Asking the host which agents it supports…
                </span>
              ) : null}
              {quickKinds.map((kind) => {
                const note = readinessNote(kind, catalog);
                return (
                  <button
                    key={kind}
                    type="button"
                    className="agent-launcher-kind"
                    disabled={Boolean(busy) || note?.blocked}
                    title={note?.text ?? `Start ${harnessLabel(kind)} here`}
                    onClick={() => void launch({ kind })}
                  >
                    <Play size={12} aria-hidden="true" /> {harnessLabel(kind)}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="agent-launcher-status" role="status">
          {catalogError ? (
            <p className="agent-launcher-error">{catalogError}</p>
          ) : null}
          {busy ? (
            <p>
              Starting {busy}: creating its tab, starting it and waiting until
              it is ready…
            </p>
          ) : null}
          {outcome ? (
            <p className={outcome.failed ? "agent-launcher-error" : undefined}>
              {outcome.message}
              {outcome.command ? (
                <>
                  <code className="agent-launcher-command">
                    {outcome.command}
                  </code>
                  <button
                    type="button"
                    className="agent-launcher-login"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(outcome.command!)
                        .catch(() => {})
                    }
                  >
                    <Copy size={13} aria-hidden="true" /> Copy
                  </button>
                </>
              ) : null}
              {outcome.terminal ? (
                <button
                  type="button"
                  className="agent-launcher-login"
                  onClick={() => {
                    onOpen(outcome.terminal!);
                    onClose();
                  }}
                >
                  Open its tab
                </button>
              ) : null}
            </p>
          ) : null}
          {error ? <p className="agent-launcher-error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
