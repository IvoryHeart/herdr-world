import { CircleAlert, X } from "lucide-react";
import { useState } from "react";
import { suggestConnectionId } from "../connectionProfiles";
import {
  type CoreConnectionSummary,
  type CoreProfileDraft,
  coreConnectionStatus,
  coreProfilePayload,
  coreTerminalLabel,
} from "../coreConnections";

type Feedback = { kind: "success" | "error"; message: string } | null;
const LISTED = 8;

/** Add a herdr-core connection. World reads core.lock; it never starts core. */
export function CoreProfileForm({
  pending,
  feedback,
  onCancel,
  onSave,
  onTest,
  onInvalid,
}: {
  pending: string | null;
  feedback: Feedback;
  onCancel: () => void;
  onSave: (profile: unknown) => void;
  onTest: (profile: unknown) => void;
  onInvalid: (message: string) => void;
}) {
  const [draft, setDraft] = useState<CoreProfileDraft>({
    id: "",
    label: "",
    where: "local",
    sshDestination: "",
    session: "default",
    stateDir: "",
    autoConnect: true,
  });
  const [idWasEdited, setIdWasEdited] = useState(false);
  const update = <K extends keyof CoreProfileDraft>(
    key: K,
    value: CoreProfileDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const payload = (act: (profile: unknown) => void) => {
    try {
      act(coreProfilePayload(draft));
    } catch (error) {
      onInvalid((error as Error).message);
    }
  };
  return (
    <form
      aria-busy={!!pending}
      onSubmit={(event) => {
        event.preventDefault();
        payload(onSave);
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id="connection-profile-form-title">Add herdr-core connection</h2>
          <p>
            Watch a herdr-core that is already running. World never starts one.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onCancel}
          aria-label="Back"
          disabled={!!pending}
        >
          <X size={16} />
        </button>
      </div>
      <label className="form-field">
        <span>Label</span>
        <input
          autoFocus
          data-initial-focus
          value={draft.label}
          maxLength={80}
          onChange={(event) => {
            const label = event.target.value;
            setDraft((current) => ({
              ...current,
              label,
              id: idWasEdited ? current.id : suggestConnectionId(label),
            }));
          }}
          placeholder="Workstation core"
        />
      </label>
      <label className="form-field">
        <span>Connection ID</span>
        <input
          value={draft.id}
          maxLength={128}
          onChange={(event) => {
            setIdWasEdited(true);
            update("id", event.target.value);
          }}
          placeholder="workstation-core"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <fieldset className="form-field">
        <span>Where core runs</span>
        <label className="connection-profile-checkbox">
          <input
            type="radio"
            name="core-where"
            checked={draft.where === "local"}
            onChange={() => update("where", "local")}
          />
          This computer
        </label>
        <label className="connection-profile-checkbox">
          <input
            type="radio"
            name="core-where"
            checked={draft.where === "ssh"}
            onChange={() => update("where", "ssh")}
          />
          A Unix host over SSH
        </label>
        <label className="connection-profile-checkbox">
          <input
            type="radio"
            name="core-where"
            checked={draft.where === "windows"}
            onChange={() => update("where", "windows")}
          />
          A Windows host over SSH
        </label>
      </fieldset>
      {draft.where !== "local" ? (
        <label className="form-field">
          <span>OpenSSH destination</span>
          <input
            value={draft.sshDestination}
            onChange={(event) => update("sshDestination", event.target.value)}
            placeholder="alias or user@host.example"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
      ) : null}
      <label className="form-field">
        <span>Core session</span>
        <input
          value={draft.session}
          maxLength={64}
          onChange={(event) => update("session", event.target.value)}
          placeholder="default"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="form-field">
        <span>State directory (optional)</span>
        <input
          value={draft.stateDir}
          onChange={(event) => update("stateDir", event.target.value)}
          placeholder={
            draft.where === "windows"
              ? "%LOCALAPPDATA%\\herdr-core\\<session> when empty"
              : "~/.local/state/herdr-core/<session> when empty"
          }
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="connection-profile-checkbox">
        <input
          type="checkbox"
          checked={draft.autoConnect}
          onChange={(event) => update("autoConnect", event.target.checked)}
        />
        Connect automatically when Herdr World starts
      </label>
      <p className="connection-profile-security-note">
        {draft.where === "windows"
          ? "World reads core.lock with a fixed PowerShell script, then relays core's named pipe over SSH on every attempt. It runs no program there, so a core that is not running stays unavailable until you start it."
          : "World reads core.lock and connects to that socket on every attempt. A core that is not running stays unavailable until you start it."}
      </p>
      {feedback ? (
        <div
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            feedback.kind === "error" ? "modal-error" : "modal-message"
          }
        >
          {feedback.message}
        </div>
      ) : null}
      <div className="modal-actions">
        <button
          type="button"
          onClick={() => payload(onTest)}
          disabled={!!pending}
        >
          {pending === "test-form" ? "Testing..." : "Test connection"}
        </button>
        <button type="button" onClick={onCancel} disabled={!!pending}>
          Cancel
        </button>
        <button type="submit" disabled={!!pending}>
          {pending === "save" ? "Saving..." : "Add connection"}
        </button>
      </div>
    </form>
  );
}

/** herdr-core connections with their live or stale observation. */
export function CoreConnectionCards({
  connections,
  pending,
  act,
  onRemove,
}: {
  connections: CoreConnectionSummary[];
  pending: string | null;
  act: (key: string, method: string, id: string, success: string) => void;
  onRemove: (connection: CoreConnectionSummary) => void;
}) {
  if (connections.length === 0) return null;
  return (
    <>
      {connections.map((connection) => {
        const observed = connection.observation;
        const live = connection.state === "ready";
        const listed = observed?.terminals.filter((t) => !t.remote) ?? [];
        return (
          <section
            className="connection-manager-card"
            key={connection.id}
            data-core-connection={connection.id}
          >
            <div className="connection-manager-card-head">
              <span
                className={`connection-runtime-dot connection-runtime-${
                  live && observed?.state === "live"
                    ? "ready"
                    : connection.state === "ready"
                      ? "reconnecting"
                      : connection.state
                }`}
              />
              <div>
                <strong>{connection.label}</strong>
                <span>
                  herdr-core ·{" "}
                  {connection.type === "ssh"
                    ? `${connection.ssh_destination}${
                        connection.remote_platform === "windows"
                          ? " (Windows)"
                          : ""
                      }`
                    : "this computer"}
                </span>
              </div>
              <div className="connection-profile-badges">
                <span>{coreConnectionStatus(connection)}</span>
              </div>
            </div>
            <div className="connection-profile-paths">
              <code>Session: {connection.core_session}</code>
              <code>
                State: {connection.core_state_dir || "default for the session"}
              </code>
              {observed?.core ? (
                <code title={observed.core.id}>
                  Core: {observed.core.name} · pid {observed.core.pid}
                </code>
              ) : null}
            </div>
            {listed.length > 0 ? (
              <ul
                className="connection-core-terminals"
                aria-label={`${connection.label} terminals${
                  observed?.state === "stale" ? " (stale)" : ""
                }`}
              >
                {listed.slice(0, LISTED).map((terminal) => (
                  <li key={terminal.address}>
                    <code>{coreTerminalLabel(terminal)}</code>
                  </li>
                ))}
                {listed.length > LISTED ? (
                  <li>and {listed.length - LISTED} more</li>
                ) : null}
              </ul>
            ) : null}
            {connection.error?.message ? (
              <div className="connection-profile-error">
                <CircleAlert size={13} /> {connection.error.message}
              </div>
            ) : null}
            {observed && observed.unknown_events.length > 0 ? (
              <div className="connection-profile-policy">
                Newer core events not shown yet:{" "}
                {observed.unknown_events.join(", ")}
              </div>
            ) : null}
            <div className="connection-profile-actions">
              <button
                type="button"
                disabled={!!pending}
                onClick={() =>
                  act(
                    `test-${connection.id}`,
                    "connections.test",
                    connection.id,
                    "Core answered.",
                  )
                }
              >
                {pending === `test-${connection.id}` ? "Testing..." : "Test"}
              </button>
              {connection.state === "disconnected" ||
              connection.state === "error" ? (
                <button
                  type="button"
                  disabled={!!pending}
                  onClick={() =>
                    act(
                      `connect-${connection.id}`,
                      "connections.connect",
                      connection.id,
                      "Connection started.",
                    )
                  }
                >
                  Connect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!!pending}
                  onClick={() =>
                    act(
                      `disconnect-${connection.id}`,
                      "connections.disconnect",
                      connection.id,
                      "Disconnected.",
                    )
                  }
                >
                  Disconnect
                </button>
              )}
              {connection.read_only ? null : (
                <button
                  type="button"
                  disabled={!!pending}
                  onClick={() => onRemove(connection)}
                >
                  Remove
                </button>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** The `?coreFixture` testing switch: drive the stand-in core. */
export function CoreFixturePanel({
  pending,
  run,
}: {
  pending: string | null;
  run: (
    action: "start" | "kill" | "remove" | "turn" | "unread" | "pin",
    success: string,
  ) => void;
}) {
  return (
    <section className="connection-manager-card" data-core-fixture>
      <div className="connection-manager-card-head">
        <div>
          <strong>Fixture core (testing)</strong>
          <span>
            A stand-in herdr-core inside this World service with four synthetic
            agents and a shell. Nothing is installed and no program runs.
          </span>
        </div>
      </div>
      <div className="connection-profile-actions">
        <button
          type="button"
          disabled={!!pending}
          onClick={() => run("start", "Fixture core is running.")}
        >
          Start fixture core
        </button>
        <button
          type="button"
          disabled={!!pending}
          onClick={() => run("kill", "Fixture core was killed.")}
        >
          Kill fixture core
        </button>
        <button
          type="button"
          disabled={!!pending}
          onClick={() => run("remove", "Fixture core removed.")}
        >
          Remove fixture
        </button>
      </div>
      <span>
        Scout's seen and favourite are shared with Herdr's apps. These stand in
        for a person using the phone or desktop app:
      </span>
      <div className="connection-profile-actions">
        <button
          type="button"
          disabled={!!pending}
          onClick={() =>
            run("turn", "Scout is working; it finishes in about 3 seconds.")
          }
        >
          Scout: finish another turn
        </button>
        <button
          type="button"
          disabled={!!pending}
          onClick={() => run("unread", "Another app marked scout unread.")}
        >
          Another app: mark scout unread
        </button>
        <button
          type="button"
          disabled={!!pending}
          onClick={() => run("pin", "Another app changed scout's favourite.")}
        >
          Another app: pin or unpin scout
        </button>
      </div>
    </section>
  );
}
