import { Copy, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AccessOriginList, uniqueHttpOrigins } from "./AccessOriginList";
import type { BridgeHttpUrl } from "./bridgeApi";
import {
  applyRemoteAccess,
  bridgeAddress,
  fetchRemoteAccess,
  remoteAccessDraft,
  remoteAccessMatchesDraft,
  waitForRemoteAccessReady,
  type RemoteAccessDraft,
  type RemoteAccessStatus,
  type RemotePasswordAction,
} from "./remoteAccess";

type Props = {
  httpUrl: BridgeHttpUrl;
  reloadPage?: () => void;
};

export function RemoteAccessSettings({
  httpUrl,
  reloadPage = () => window.location.reload(),
}: Props) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [draft, setDraft] = useState<RemoteAccessDraft | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [passwordAction, setPasswordAction] = useState<RemotePasswordAction>("keep");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRemoteAccess(httpUrl).then((next) => {
      if (cancelled) return;
      setStatus(next);
      setDraft(remoteAccessDraft(next));
    }).catch((error: unknown) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Sharing settings unavailable");
      }
    });
    return () => { cancelled = true; };
  }, [httpUrl]);

  const clientOriginSuggestions = useMemo(() => uniqueHttpOrigins([
    globalThis.location?.origin,
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://localhost",
  ]), []);

  if (!status || !draft) {
    return (
      <div className="settings-section settings-section-flat">
        {message ?? "Loading sharing settings…"}
      </div>
    );
  }

  const address = draft.accepted_hosts[0]
    ? bridgeAddress(draft.accepted_hosts[0], status.port)
    : null;
  const addAddress = (raw: string) => {
    const value = raw.trim();
    if (!value || draft.accepted_hosts.includes(value)) return false;
    setDraft({ ...draft, accepted_hosts: [...draft.accepted_hosts, value] });
    return true;
  };
  const toggleSharing = () => {
    if (draft.enabled) {
      setDraft({ ...draft, enabled: false });
      return;
    }
    const acceptedHosts = draft.accepted_hosts.length > 0
      ? draft.accepted_hosts
      : status.suggestions.slice(0, 1);
    const allowedPageOrigins = draft.allowed_page_origins.length > 0
      ? draft.allowed_page_origins
      : clientOriginSuggestions;
    setSelectedSuggestions((current) => uniqueValues([...current, ...acceptedHosts]));
    setDraft({
      ...draft,
      enabled: true,
      accepted_hosts: acceptedHosts,
      allowed_page_origins: allowedPageOrigins,
    });
  };
  const save = async () => {
    setBusy(true);
    setMessage("Saving sharing settings and restarting this bridge…");
    try {
      const apply = await applyRemoteAccess(httpUrl, draft, passwordAction, password || undefined);
      setStatus((current) => current ? { ...current, apply } : current);
      if (apply.state === "failed") {
        throw new Error(apply.reason ?? "The bridge could not apply the sharing settings");
      }
      const expectedPasswordConfigured = passwordAction === "set"
        ? true
        : passwordAction === "remove"
          ? false
          : status.remote_access.password_configured;
      const ready = await waitForRemoteAccessReady(
        httpUrl,
        (next) => remoteAccessMatchesDraft(next, draft, expectedPasswordConfigured),
      );
      setStatus(ready);
      setPassword("");
      setPasswordAction("keep");
      setMessage("Sharing settings applied. Reloading Herdr World…");
      setBusy(false);
      reloadPage();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply sharing settings");
    } finally {
      setBusy(false);
    }
  };

  const invalidEnabledDraft = draft.enabled && (
    draft.accepted_hosts.length === 0 || draft.allowed_page_origins.length === 0
  );

  return (
    <div className="settings-section remote-access-settings">
      <div className="settings-label">Share this bridge</div>
      <p className="settings-help">
        Let another device connect directly to the bridge running on this machine over a trusted
        LAN or VPN. This is separate from adding other machines under Bridges.
      </p>
      <div className="settings-row remote-access-toggle-row">
        <span>Allow other devices to connect</span>
        <button
          className="backend-toggle"
          type="button"
          role="switch"
          aria-label="Allow other devices to connect"
          aria-checked={draft.enabled}
          data-on={draft.enabled ? "true" : undefined}
          onClick={toggleSharing}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {!draft.enabled ? (
        <p className="backend-note">
          This machine accepts local connections only. Its saved sharing settings are retained.
        </p>
      ) : null}

      <div className="remote-access-subsection">
        <strong>Addresses for this bridge</strong>
        <p className="settings-help">
          These are this machine&apos;s hostname or IP address—the value another device puts in its
          Bridge URL. They are not addresses of allowed client devices.
        </p>
        {draft.accepted_hosts.length === 0 ? (
          <span className="backend-warning">Add an address for this machine before applying.</span>
        ) : null}
        {draft.accepted_hosts.map((host) => (
          <div className="remote-access-chip" key={host}>
            <span>{host}</span>
            <button
              type="button"
              aria-label={`Remove ${host}`}
              onClick={() => setDraft({
                ...draft,
                accepted_hosts: draft.accepted_hosts.filter((item) => item !== host),
              })}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {status.suggestions.filter((item) => !draft.accepted_hosts.includes(item)).map((suggestion) => (
          <label className="remote-access-suggestion" key={suggestion}>
            <input
              type="checkbox"
              checked={selectedSuggestions.includes(suggestion)}
              onChange={(event) => {
                setSelectedSuggestions((current) => event.target.checked
                  ? uniqueValues([...current, suggestion])
                  : current.filter((item) => item !== suggestion));
                if (event.target.checked) addAddress(suggestion);
                else setDraft((current) => current ? {
                  ...current,
                  accepted_hosts: current.accepted_hosts.filter((item) => item !== suggestion),
                } : current);
              }}
            />
            <span>{suggestion}</span>
            <small>Detected on this machine</small>
          </label>
        ))}
        <div className="remote-access-add-row">
          <input
            className="field"
            aria-label="Add this machine address"
            placeholder="hostname or IP literal"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => { if (addAddress(addressInput)) setAddressInput(""); }}
          >
            Add address
          </button>
        </div>
      </div>

      {draft.enabled && address ? (
        <div className="remote-access-address">
          <span>Bridge URL for other devices</span>
          <code>{address}</code>
          <button type="button" className="btn" onClick={() => void copyValue(address)}>
            <Copy size={13} /> Copy
          </button>
        </div>
      ) : null}

      <div className="remote-access-subsection">
        <strong>Password for this bridge</strong>
        <span className="backend-note">
          {status.remote_access.password_configured ? "Protected" : "Not set"}
        </span>
        <p className="settings-help">
          Other devices are asked for this password when they connect. Passwords for bridges you
          add are not stored; authenticated access lasts until the browser tab closes or the
          session expires.
        </p>
        {draft.enabled ? (
          <p className="backend-warning">
            Direct access uses unencrypted HTTP and WebSocket connections. Use only a trusted LAN
            or VPN; a password controls access but does not encrypt the connection.
          </p>
        ) : null}
        {draft.enabled && !status.remote_access.password_configured ? (
          <p className="backend-warning">
            Anyone who can reach this bridge can use it until you set a password.
          </p>
        ) : null}
        <div className="remote-access-password-row">
          <input
            className="field"
            type="password"
            aria-label={status.remote_access.password_configured
              ? "Change this bridge password"
              : "Set this bridge password"}
            placeholder={status.remote_access.password_configured ? "New password" : "Set password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordAction("set");
            }}
          />
          {status.remote_access.password_configured ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setPassword("");
                setPasswordAction("remove");
                setMessage("Password protection will be removed when you apply settings.");
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
        {status.remote_access.password_configured ? (
          <span className="backend-note">
            Enter a new password to change it, or Remove to disable protection.
          </span>
        ) : null}
      </div>

      <details className="remote-access-advanced">
        <summary>Advanced browser permissions</summary>
        <div className="remote-access-advanced-content">
          <p className="settings-help">
            Add another Herdr World page&apos;s exact URL when it needs to call this bridge. Pages
            loaded directly from this bridge are already allowed.
          </p>
          <AccessOriginList
            label="Additional client page origins"
            values={draft.allowed_page_origins}
            suggestions={clientOriginSuggestions}
            onChange={(values) => setDraft({ ...draft, allowed_page_origins: values })}
          />
        </div>
      </details>

      <div
        className={`remote-access-apply remote-access-apply-${busy ? "applying" : status.apply.state}`}
        role="status"
      >
        <strong>{busy ? "Applying sharing settings" : applyLabel(status.apply.state)}</strong>
        <span>
          {status.apply.reason ?? message ?? (status.mutation_allowed
            ? "Ready to apply."
            : status.mutation_reason ?? "Settings are read-only in this launch.")}
        </span>
      </div>
      {!status.mutation_allowed ? (
        <p className="backend-warning">
          {status.mutation_reason ?? "This launch cannot safely apply settings."}
        </p>
      ) : null}
      {message && status.apply.state !== "applying" ? (
        <div className="modal-message">{message}</div>
      ) : null}
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !status.mutation_allowed || invalidEnabledDraft}
          onClick={() => void save()}
        >
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
    </div>
  );
}

function uniqueValues(values: readonly string[]) {
  return [...new Set(values)];
}

function applyLabel(state: RemoteAccessStatus["apply"]["state"]) {
  return state === "applying"
    ? "Service restarting"
    : state === "failed"
      ? "Apply failed"
      : "Bridge ready";
}

async function copyValue(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Copy is a convenience; the address remains selectable.
  }
}
