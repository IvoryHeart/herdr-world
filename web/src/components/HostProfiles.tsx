import { useState } from "react";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { WorldHost as HostReply } from "../../../shared/hosts";
import type { HostCatalogueEntry } from "../hostGroups";
import type { Feedback } from "./LocalProfileForm";

/** What adding or looking again at a host found, in one sentence. */
export function hostFoundMessage(
  host: Pick<HostReply, "label" | "runtimes" | "discovery" | "discovery_error">,
) {
  const found = host.runtimes.filter((runtime) => runtime.installed);
  if (host.discovery === "error")
    return `World could not look for runtimes on ${host.label}: ${host.discovery_error ?? "discovery failed"}.`;
  if (!found.length)
    return `No runtime found on ${host.label}. Add one from Integrations.`;
  const names = found.map((runtime) =>
    runtime.kind === "herdr" ? "Herdr" : runtime.kind,
  );
  return `Found ${names.join(" and ")} on ${host.label}. Connecting.`;
}

/**
 * Add host: the machine only (an OpenSSH alias or `user@host`). World looks
 * for runtimes there itself and connects what it finds; nothing here asks
 * about runtimes. OpenSSH config holds every other SSH setting.
 */
export function AddHostForm({
  pending,
  feedback,
  onCancel,
  onAdd,
}: {
  pending: string | null;
  feedback: Feedback;
  onCancel(): void;
  onAdd(host: {
    type: "ssh";
    ssh_destination: string;
    remote_platform?: "windows";
  }): void;
}) {
  const [destination, setDestination] = useState("");
  const [windows, setWindows] = useState(false);
  return (
    <form
      aria-busy={!!pending}
      aria-describedby={feedback ? "connection-profile-feedback" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        const name = destination.trim();
        if (!name) return;
        onAdd({
          type: "ssh",
          ssh_destination: name,
          ...(windows ? { remote_platform: "windows" as const } : {}),
        });
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id="connection-profile-form-title">Add host</h2>
          <p>
            Name the machine as you would for <code>ssh</code>. World finds the
            runtimes on it and connects them.
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
        <span>SSH name</span>
        <input
          autoFocus
          data-initial-focus
          value={destination}
          maxLength={320}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="dev-box or user@dev.example.com"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="connection-profile-checkbox">
        <input
          type="checkbox"
          checked={windows}
          onChange={(event) => setWindows(event.target.checked)}
        />
        This is a Windows machine
      </label>
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
        <button type="button" onClick={onCancel} disabled={!!pending}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary"
          disabled={!!pending || !destination.trim()}
        >
          {pending === "add-host" ? "Looking for runtimes…" : "Add host"}
        </button>
      </div>
    </form>
  );
}

function hostCardState(host: HostCatalogueEntry) {
  if (host.discovery === "pending") return "Looking for runtimes…";
  if (host.discovery === "error") return "Could not look for runtimes";
  switch (host.state) {
    case "ready":
      return "Ready";
    case "degraded":
      return "Partly ready";
    case "unavailable":
      return "Unavailable";
    case "empty":
      return "No runtime found";
    default:
      return "Disconnected";
  }
}

/**
 * The machines World knows, one card each. Their runtimes are listed (and
 * another added) in Integrations; here a host can be looked at again or
 * removed with everything World keeps for it.
 */
export function HostCards({
  hosts,
  pending,
  onDiscover,
  onRemove,
  onAddRuntime,
}: {
  hosts: readonly HostCatalogueEntry[];
  pending: string | null;
  onDiscover(host: HostCatalogueEntry): void;
  onRemove(host: HostCatalogueEntry): void;
  onAddRuntime(host: HostCatalogueEntry): void;
}) {
  if (!hosts.length) return null;
  return (
    <section className="connection-manager-hosts" aria-label="Hosts">
      <h3>Hosts</h3>
      {hosts.map((host) => (
        <div
          key={host.id}
          className="connection-manager-card connection-manager-host"
          data-host={host.id}
        >
          <div className="connection-manager-card-head">
            <span
              className={`connection-runtime-dot connection-runtime-${
                host.state === "ready"
                  ? "ready"
                  : host.state === "degraded" || host.discovery === "pending"
                    ? "connecting"
                    : host.state === "unavailable"
                      ? "error"
                      : "disconnected"
              }`}
            />
            <div>
              <strong>{host.label}</strong>
              <span>
                {host.type === "local" ? "This computer" : "SSH"}
                {host.windows ? " · Windows" : ""}
              </span>
            </div>
            <div className="connection-profile-badges">
              <span>{hostCardState(host)}</span>
            </div>
          </div>
          {host.discoveryError ? (
            <p className="modal-error">{host.discoveryError}</p>
          ) : null}
          {host.state === "empty" && host.installable.length ? (
            <p className="connection-manager-host-empty">
              Can be installed here:{" "}
              {host.installable.map(({ label }) => label).join(", ")}.
            </p>
          ) : null}
          <div className="connection-profile-actions">
            {host.state === "empty" ? (
              <button
                type="button"
                disabled={!!pending}
                onClick={() => onAddRuntime(host)}
              >
                <Plus size={14} /> Add a runtime
              </button>
            ) : null}
            <button
              type="button"
              disabled={!!pending}
              aria-label={`Look again on ${host.label}`}
              onClick={() => onDiscover(host)}
            >
              <RefreshCw size={14} /> Look again
            </button>
            {host.type === "ssh" ? (
              <button
                type="button"
                className="danger"
                disabled={!!pending}
                aria-label={`Remove host ${host.label}`}
                onClick={() => onRemove(host)}
              >
                <Trash2 size={14} /> Remove host
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}
