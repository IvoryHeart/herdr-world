import { X } from "lucide-react";
import { useState } from "react";
import type { ConnectionSummary } from "../api";
import { suggestConnectionId } from "../connectionProfiles";

export type Feedback = { kind: "success" | "error"; message: string } | null;

export type Draft = {
  id: string;
  label: string;
  controlSocketPath: string;
  clientSocketPath: string;
  autoConnect: boolean;
};

function draftFor(connection?: ConnectionSummary): Draft {
  return {
    id: connection?.id ?? "",
    label: connection?.label ?? "",
    controlSocketPath: connection?.control_socket_path ?? "",
    clientSocketPath: connection?.client_socket_path ?? "",
    autoConnect: connection?.auto_connect ?? true,
  };
}

/** Add or edit a local Herdr connection (control and render sockets). */
export function ProfileForm({
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
  onSave: (draft: Draft) => void;
  onTest: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState(() => draftFor(connection));
  const [idWasEdited, setIdWasEdited] = useState(false);
  const isEditing = !!connection;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
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
            {isEditing ? "Edit local connection" : "Add local connection"}
          </h2>
          <p>Attach to existing Herdr control and render Unix sockets.</p>
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
                  ? suggestConnectionId(label)
                  : current.id,
            }));
          }}
          placeholder="Local development"
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
          placeholder="local-dev"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="form-field">
        <span>Control socket path</span>
        <input
          value={draft.controlSocketPath}
          onChange={(event) => update("controlSocketPath", event.target.value)}
          placeholder="/absolute/path/to/herdr.sock"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="form-field">
        <span>Render socket path</span>
        <input
          value={draft.clientSocketPath}
          onChange={(event) => update("clientSocketPath", event.target.value)}
          placeholder="/absolute/path/to/herdr-client.sock"
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
        Local profiles store socket paths only. SSH commands, credentials, keys,
        and passphrases are never accepted here.
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
