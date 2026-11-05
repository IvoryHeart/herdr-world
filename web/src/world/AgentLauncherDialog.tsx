import {
  Copy,
  LogIn,
  Play,
  RefreshCw,
  Settings2,
  Terminal,
} from "lucide-react";
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
import { store } from "../store";
import "./agentProfiles.css";

/**
 * Pick a room and a plain Terminal, profile or agent kind. Agent choices
 * create the tab, start the harness, wait until it is ready and send the first
 * prompt (agent/launch.ts); Terminal uses the shared qualified creation action.
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
  onOpen(terminal: {
    connectionId: string;
    runtimeGeneration: number;
    terminalId: string;
  }): void;
  onEditProfiles(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dismiss = () => {
    if (!mounted.current) return;
    mounted.current = false;
    onClose();
  };
  useLayer(true, dismiss, { element: () => ref.current });
  const { document } = useAgentProfiles();
  const profiles = document?.profiles ?? [];
  // A ready host keeps its rooms listed while one observation is uncertain
  // (invalidated in flight); only actionable rooms can start anything.
  const rooms = useMemo(
    () =>
      world.spaces.filter((space) => {
        if (space.actionable && !space.stale) return true;
        const host = world.hosts.find(({ id }) => id === space.parentId);
        return (
          host?.connection.state === "ready" &&
          host.connection.generation === space.generation
        );
      }),
    [world.spaces, world.hosts],
  );
  const preferred = initial.profileId
    ? profiles.find((p) => p.id === initial.profileId)
    : undefined;
  const [selection, setSelection] = useState<{
    id: string;
    generation: number;
  } | null>(() => {
    const explicit =
      initial.connectionId !== undefined ||
      initial.workspaceId !== undefined ||
      initial.generation !== undefined;
    const exact = rooms.find(
      (space) =>
        space.connectionId === initial.connectionId &&
        space.nativeId === initial.workspaceId &&
        space.generation === initial.generation,
    );
    const home = preferred?.home_room
      ? rooms.find((space) => space.label === preferred.home_room)
      : undefined;
    const chosen = explicit ? exact : (home ?? rooms[0]);
    return chosen ? { id: chosen.id, generation: chosen.generation } : null;
  });
  const room = selection
    ? (rooms.find(
        (space) =>
          space.id === selection.id &&
          space.generation === selection.generation,
      ) ?? null)
    : null;
  const target: LaunchTarget | null =
    room?.actionable && !room.stale
      ? {
          connectionId: room.connectionId,
          generation: room.generation,
          workspaceId: room.nativeId,
          workspaceLabel: room.label,
        }
      : null;
  const [task, setTask] = useState("");
  const [catalog, setCatalog] = useState<LauncherCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  // Fence synchronous clicks as well as retries after an uncertain outcome.
  const attempt = useRef(false);
  const operation = useRef(false);
  const [loginBusy, setLoginBusy] = useState<string | null>(null);
  const locked = attempted || Boolean(busy) || Boolean(loginBusy);
  const [outcome, setOutcome] = useState<RetainedOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectionId = room?.connectionId;
  const generation = room?.generation;
  const workspaceId = room?.nativeId;
  useEffect(() => {
    setCatalog(null);
    setCatalogError(null);
    if (
      !mounted.current ||
      !connectionId ||
      generation === undefined ||
      !workspaceId
    )
      return;
    let current = true;
    launcherCatalog({ connectionId, generation, workspaceId })
      .then((next) => current && mounted.current && setCatalog(next))
      .catch(
        (cause: unknown) =>
          current &&
          mounted.current &&
          setCatalogError(
            cause instanceof Error ? cause.message : String(cause),
          ),
      );
    return () => {
      current = false;
    };
  }, [connectionId, generation, workspaceId, checks]);

  const launch = async (choice: { profile?: AgentProfile; kind?: string }) => {
    if (!mounted.current || !target || operation.current || attempt.current)
      return;
    operation.current = true;
    attempt.current = true;
    setAttempted(true);
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
      if (!mounted.current) return;
      // A ready agent opens and the dialog closes; anything else stays
      // here with its reason and a way to open the tab.
      if (
        (result.status === "sent" || result.status === "started") &&
        result.terminal_id
      ) {
        onOpen({
          connectionId: target.connectionId,
          runtimeGeneration: target.generation,
          terminalId: result.terminal_id,
        });
        dismiss();
        return;
      }
      if (result.status === "failed") {
        attempt.current = false;
        setAttempted(false);
      }
      setOutcome(retainedOutcome(target, result));
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        operation.current = false;
        setBusy(null);
      }
    }
  };

  const createTerminal = async () => {
    if (!mounted.current || !target || operation.current || attempt.current)
      return;
    operation.current = true;
    attempt.current = true;
    setAttempted(true);
    setBusy("Terminal");
    setOutcome(null);
    setError(null);
    try {
      await store.createQualifiedTab(
        {
          connectionId: target.connectionId,
          runtimeGeneration: target.generation,
        },
        target.workspaceId,
        { numberedLabel: true },
      );
      dismiss();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        operation.current = false;
        setBusy(null);
      }
    }
  };

  const logIn = async (kind: string) => {
    if (!mounted.current || !target || operation.current || attempt.current)
      return;
    operation.current = true;
    setLoginBusy(kind);
    setOutcome(null);
    setError(null);
    try {
      // World types nothing into the tab; the user runs the command there.
      const opened = await openHarnessLogin(target, kind);
      if (!mounted.current) return;
      setOutcome(
        retainedOutcome(target, {
          status: "opened",
          message: `A login tab for ${harnessLabel(kind)} is open in ${target.workspaceLabel}. Run this there, finish the login, then Check again:`,
          terminal_id: opened.terminal_id,
          command: opened.command,
        }),
      );
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        operation.current = false;
        setLoginBusy(null);
      }
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
          <CloseButton onClick={dismiss} label="Close new agent" />
        </div>
        <div className="agent-launcher-status" role="status">
          {catalogError ? (
            <p className="agent-launcher-error">{catalogError}</p>
          ) : null}
          {loginBusy ? (
            <p>Opening a login tab for {harnessLabel(loginBusy)}…</p>
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
                    if (!mounted.current) return;
                    onOpen(outcome.terminal!);
                    dismiss();
                  }}
                >
                  Open its tab
                </button>
              ) : null}
            </p>
          ) : null}
          {error ? <p className="agent-launcher-error">{error}</p> : null}
        </div>
        <div className="agent-launcher-choices">
          {rooms.length === 0 ? (
            <p className="agent-launcher-note">
              Connect a host and create a room first.
            </p>
          ) : (
            <>
              {!room ? (
                <p className="agent-launcher-note" role="status">
                  The requested room is unavailable. Choose a current room to
                  continue.
                </p>
              ) : null}
              <label className="agent-field">
                <span>Room</span>
                <select
                  value={room?.id ?? ""}
                  disabled={locked}
                  onChange={(event) => {
                    const chosen = rooms.find(
                      (space) => space.id === event.target.value,
                    );
                    setSelection(
                      chosen
                        ? { id: chosen.id, generation: chosen.generation }
                        : null,
                    );
                  }}
                >
                  {!room ? (
                    <option value="" disabled>
                      Choose a current room
                    </option>
                  ) : null}
                  {rooms.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.label} · {space.hostLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="agent-field">
                <span>Agent task (optional)</span>
                <textarea
                  value={task}
                  disabled={locked}
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
                    disabled={locked}
                    title={`Opens a tab and shows ${harnessLabel(kind)}'s login command to run there`}
                    onClick={() => void logIn(kind)}
                  >
                    <LogIn size={13} aria-hidden="true" /> Log in
                  </button>
                </p>
              ))}
              <button
                type="button"
                className="agent-launcher-card"
                disabled={!target || locked}
                onClick={() => void createTerminal()}
              >
                <Terminal size={24} aria-hidden="true" />
                <span>
                  <b>Terminal</b>
                  <small>A plain shell in this room</small>
                </span>
              </button>
              <div className="agent-launcher-section-head">
                <h3>From a profile</h3>
                <button
                  type="button"
                  onClick={onEditProfiles}
                  disabled={locked}
                >
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
                      disabled={!target || locked || !catalog || note?.blocked}
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
                {target && !catalog && !catalogError ? (
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
                      disabled={!target || locked || note?.blocked}
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
        </div>
      </div>
    </div>
  );
}
