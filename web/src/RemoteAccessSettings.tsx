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
        setMessage(error instanceof Error ? error.message : "Connection settings unavailable");
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
    setMessage("Applying network settings…");
    try {
      const apply = await applyRemoteAccess(httpUrl, draft, passwordAction, password || undefined);
      setStatus((current) => current ? { ...current, apply } : current);
      if (apply.state === "failed") {
        throw new Error(apply.reason ?? "This Herdr could not apply the network settings");
      }
      const expectedPasswordConfigured = passwordAction === "set"
        ? true
        : passwordAction === "remove"
          ? false
          : status.remote_access.password_configured;
      const ready = await waitForRemoteAccessReady(
        httpUrl,
        apply.id,
        (next) => remoteAccessMatchesDraft(next, draft, expectedPasswordConfigured),
      );
      setStatus(ready);
      setPassword("");
      setPasswordAction("keep");
      setMessage("Network settings applied. Reloading Herdr World…");
      setBusy(false);
      reloadPage();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply network settings");
    } finally {
      setBusy(false);
    }
  };

  const invalidEnabledDraft = draft.enabled && draft.accepted_hosts.length === 0;

  return (
    <div className="settings-section remote-access-settings">
      <div className="settings-label">Allow connections</div>
      <p className="settings-help">
        Allow Herdr World on other devices to connect to this Herdr over a trusted LAN or VPN.
      </p>
      <div className="settings-row remote-access-toggle-row">
        <span>Allow connections to this Herdr</span>
        <button
          className="backend-toggle"
          type="button"
          role="switch"
          aria-label="Allow connections to this Herdr"
          aria-checked={draft.enabled}
          data-on={draft.enabled ? "true" : undefined}
          onClick={toggleSharing}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {!draft.enabled ? (
        <p className="backend-note">
          Only pages opened locally can connect. Saved network settings are retained.
        </p>
      ) : null}

      {draft.enabled && address ? (
        <div className="remote-access-address">
          <span>Address</span>
          <code>{address}</code>
          <button type="button" className="btn" onClick={() => void copyValue(address)}>
            <Copy size={13} /> Copy address
          </button>
        </div>
      ) : null}

      {draft.enabled && !address ? (
        <div className="remote-access-subsection">
          <strong>Address</strong>
          <p className="settings-help">
            Enter a hostname or IP address that another device can use to reach this Herdr.
          </p>
          <div className="remote-access-add-row">
            <input
              className="field"
              aria-label="Herdr address"
              placeholder="hostname or IP address"
              value={addressInput}
              onChange={(event) => setAddressInput(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => { if (addAddress(addressInput)) setAddressInput(""); }}
            >
              Use address
            </button>
          </div>
          <span className="backend-warning">Add an address before applying.</span>
        </div>
      ) : null}

      {draft.enabled ? (
        <div className="remote-access-subsection">
          <strong>Authentication</strong>
          <span className="backend-note">
            {status.remote_access.password_configured ? "Password protected" : "No password"}
          </span>
          <p className="backend-warning">
            Direct connections are not encrypted. Use only a trusted LAN or VPN; a password
            controls access but does not hide network traffic.
          </p>
          {!status.remote_access.password_configured ? (
            <p className="backend-warning">
              Anyone who can reach this address can connect until you set a password.
            </p>
          ) : null}
          <div className="remote-access-password-row">
            <input
              className="field"
              type="password"
              aria-label={status.remote_access.password_configured
                ? "Change connection password"
                : "Set connection password"}
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
                  setMessage("Password protection will be removed when you apply changes.");
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
          {status.remote_access.password_configured ? (
            <span className="backend-note">
              Enter a new password to change it, or remove password protection.
            </span>
          ) : null}
        </div>
      ) : null}

      <details className="remote-access-advanced">
        <summary>Advanced network permissions</summary>
        <div className="remote-access-advanced-content">
          <p className="settings-help">
            These restrictions control which addresses this Herdr answers to and which web pages
            may connect. They are not a list of connecting devices.
          </p>
          <div className="remote-access-permission-list">
            <span>Addresses this Herdr responds to</span>
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
                <small>Detected</small>
              </label>
            ))}
            <div className="remote-access-add-row">
              <input
                className="field"
                aria-label="Add address this Herdr responds to"
                placeholder="hostname or IP address"
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
          <AccessOriginList
            label="Web pages allowed to connect"
            values={draft.allowed_page_origins}
            suggestions={clientOriginSuggestions}
            onChange={(values) => setDraft({ ...draft, allowed_page_origins: values })}
          />
          <p className="settings-help">
            A page opened from this Herdr is allowed automatically. Add an exact page address only
            when Herdr World is loaded from somewhere else.
          </p>
        </div>
      </details>

      {draft.enabled && status.mutation_allowed ? (
        <p className="backend-note">
          Applying changes briefly disconnects remote pages. They may need to enter the password
          again after this Herdr restarts.
        </p>
      ) : null}

      <div
        className={`remote-access-apply remote-access-apply-${busy ? "applying" : status.apply.state}`}
        role="status"
      >
        <strong>{busy ? "Applying network settings" : applyLabel(status.apply.state)}</strong>
        <span>
          {busy
            ? "The connection service is restarting."
            : status.apply.state === "failed"
              ? status.apply.reason ?? message ?? "The previous settings were kept."
              : message ?? (status.mutation_allowed
                ? "Ready to apply changes."
                : status.mutation_reason ?? "Settings are read-only in this launch.")}
        </span>
      </div>
      {!status.mutation_allowed ? (
        <p className="backend-warning">
          {status.mutation_reason ?? "This launch cannot safely apply settings."}
        </p>
      ) : null}
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !status.mutation_allowed || invalidEnabledDraft}
          onClick={() => void save()}
        >
          {busy ? "Applying…" : "Apply changes"}
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
    ? "Applying network settings"
    : state === "failed"
      ? "Could not apply changes"
      : "Network ready";
}

async function copyValue(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Copy is a convenience; the address remains selectable.
  }
}
