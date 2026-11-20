/** The SSH runtime profile form, set by hand (Manage connections). */
import { X } from "lucide-react";
import { useState } from "react";
import type { ConnectionSummary } from "../api";
import { suggestConnectionId } from "../connectionProfiles";
import type { Feedback } from "./LocalProfileForm";

export type SshDraft = {
  id: string;
  label: string;
  sshDestination: string;
  remoteControlSocketPath: string;
  remoteClientSocketPath: string;
  autoConnect: boolean;
  remotePlatform?: "windows";
  remoteHerdrPath: string;
  remoteSession: string;
};

function sshDraftFor(connection?: ConnectionSummary): SshDraft {
  return {
    id: connection?.id ?? "",
    label: connection?.label ?? "",
    sshDestination: connection?.ssh_destination ?? "",
    remoteControlSocketPath: connection?.remote_control_socket_path ?? "",
    remoteClientSocketPath: connection?.remote_client_socket_path ?? "",
    remotePlatform: connection?.remote_platform,
    remoteHerdrPath: connection?.remote_herdr_path ?? "",
    remoteSession: connection?.remote_session ?? "",
    autoConnect: connection?.auto_connect ?? true,
  };
}

export function SshProfileForm({
  connection,
  pending,
  feedback,
  onCancel,
  onSave,
  onTest,
}: {
  connection?: ConnectionSummary;
  pending: string | null;
  feedback: Feedback;
  onCancel: () => void;
  onSave: (draft: SshDraft) => void;
  onTest: (draft: SshDraft) => void;
}) {
  const [draft, setDraft] = useState(() => sshDraftFor(connection));
  const [idWasEdited, setIdWasEdited] = useState(false);
  const isEditing = !!connection;
  const update = <K extends keyof SshDraft>(key: K, value: SshDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      aria-busy={!!pending}
      aria-describedby={feedback ? "connection-profile-feedback" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id="connection-profile-form-title">
            {isEditing ? "Edit SSH connection" : "Add SSH connection"}
          </h2>
          <p>Forward an existing remote Herdr server through OpenSSH.</p>
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
              id:
                !isEditing && !idWasEdited
                  ? suggestConnectionId(label, "ssh")
                  : current.id,
            }));
          }}
          placeholder="Remote development"
        />
      </label>
      <label className="form-field">
        <span>Connection ID</span>
        <input
          value={draft.id}
          disabled={isEditing}
          maxLength={128}
          onChange={(event) => {
            setIdWasEdited(true);
            update("id", event.target.value);
          }}
          placeholder="remote-dev"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="form-field">
        <span>OpenSSH destination</span>
        <input
          value={draft.sshDestination}
          maxLength={320}
          onChange={(event) => update("sshDestination", event.target.value)}
          placeholder="user@dev-box or config-alias"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="form-field">
        <span>Remote host OS</span>
        <select
          value={draft.remotePlatform ?? "unix"}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              remotePlatform:
                event.target.value === "windows" ? "windows" : undefined,
              remoteControlSocketPath: "",
              remoteClientSocketPath: "",
              remoteHerdrPath: "",
              remoteSession: "",
            }))
          }
        >
          <option value="unix">Linux / macOS</option>
          <option value="windows">Windows</option>
        </select>
      </label>
      {draft.remotePlatform === "windows" ? (
        <>
          <label className="form-field">
            <span>Herdr executable path (optional)</span>
            <input
              value={draft.remoteHerdrPath}
              maxLength={1024}
              onChange={(event) =>
                update("remoteHerdrPath", event.target.value)
              }
              placeholder="Auto: herdr.exe in PATH"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label className="form-field">
            <span>Herdr session (optional)</span>
            <input
              value={draft.remoteSession}
              onChange={(event) => update("remoteSession", event.target.value)}
              placeholder="default"
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <>
          <label className="form-field">
            <span>Remote control socket path (optional)</span>
            <input
              value={draft.remoteControlSocketPath}
              onChange={(event) =>
                update("remoteControlSocketPath", event.target.value)
              }
              placeholder="Auto: ~/.config/herdr/herdr.sock"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label className="form-field">
            <span>Remote render socket path (optional)</span>
            <input
              value={draft.remoteClientSocketPath}
              onChange={(event) =>
                update("remoteClientSocketPath", event.target.value)
              }
              placeholder="Auto: ~/.config/herdr/herdr-client.sock"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
        </>
      )}
      <label className="connection-profile-checkbox">
        <input
          type="checkbox"
          checked={draft.autoConnect}
          onChange={(event) => update("autoConnect", event.target.checked)}
        />
        Connect automatically when Herdr World starts
      </label>
      <p className="connection-profile-security-note">
        {draft.remotePlatform === "windows"
          ? "Windows requires a running Herdr 0.9.1+ session and Windows PowerShell. The default session is used unless specified. Terminal and Herdr workspace actions are supported; remote file and Git tools require a Unix host. "
          : "Leave the socket paths empty to use the default Herdr sockets under the remote home directory. "}
        Authentication comes from the bridge service user&apos;s OpenSSH config,
        ssh-agent, or system Keychain. Establish host trust outside Herdr World.
        Passwords, keys, passphrases, commands, ports, and SSH options are never
        stored here.
      </p>
      {feedback ? (
        <div
          id="connection-profile-feedback"
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
          onClick={() => onTest(draft)}
          disabled={!!pending}
        >
          {pending === "test-form" ? "Testing..." : "Test connection"}
        </button>
        <button type="button" onClick={onCancel} disabled={!!pending}>
          Cancel
        </button>
        <button type="submit" disabled={!!pending}>
          {pending === "save"
            ? "Saving..."
            : isEditing
              ? "Save"
              : "Add connection"}
        </button>
      </div>
    </form>
  );
}
