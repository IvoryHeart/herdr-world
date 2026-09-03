import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BridgeBackendProfile } from "./bridge";
import type { BridgeHttpUrl } from "./bridgeApi";
import {
  applyRemoteAccess,
  bridgeAddress,
  fetchRemoteAccess,
  type RemoteAccessDraft,
  type RemoteAccessStatus,
  type RemotePasswordAction,
} from "./remoteAccess";

type Props = {
  httpUrl: BridgeHttpUrl;
  backends: readonly BridgeBackendProfile[];
};

export function RemoteAccessSettings({ httpUrl, backends }: Props) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [draft, setDraft] = useState<RemoteAccessDraft | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [pageOriginInput, setPageOriginInput] = useState("");
  const [bridgeOriginInput, setBridgeOriginInput] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [passwordAction, setPasswordAction] = useState<RemotePasswordAction>("keep");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const applyObserved = useRef(false);

  const reload = async () => {
    try {
      const next = await fetchRemoteAccess(httpUrl);
      setStatus(next);
      setDraft((current) => current ?? draftFromStatus(next));
      if (next.apply.state === "applying") {
        applyObserved.current = true;
      } else if (applyObserved.current) {
        applyObserved.current = false;
        setBusy(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Remote access status unavailable");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetchRemoteAccess(httpUrl).then((next) => {
      if (cancelled) return;
      setStatus(next);
      setDraft(draftFromStatus(next));
    }).catch((error: unknown) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : "Remote access status unavailable");
    });
    return () => { cancelled = true; };
  }, [httpUrl]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void reload(); }, 750);
    return () => window.clearInterval(timer);
  }, [busy, httpUrl]);

  const pageOriginSuggestions = useMemo(() => {
    const values = [
      globalThis.location?.origin,
      "http://localhost",
      "http://127.0.0.1:8787",
    ];
    return uniqueOrigins(values);
  }, []);
  const bridgeOriginSuggestions = useMemo(
    () => uniqueOrigins(backends.map((backend) => backend.baseUrl)),
    [backends],
  );

  if (!status || !draft) {
    return (
      <div className="settings-section settings-section-flat">
        {message ?? "Loading remote access…"}
      </div>
    );
  }

  const address = draft.accepted_hosts[0]
    ? bridgeAddress(draft.accepted_hosts[0], status.port)
    : null;
  const addToList = (field: "accepted_hosts" | "allowed_page_origins" | "allowed_bridge_origins", raw: string) => {
    const value = raw.trim();
    if (!value || draft[field].includes(value)) return false;
    setDraft({ ...draft, [field]: [...draft[field], value] });
    return true;
  };
  const save = async () => {
    applyObserved.current = false;
    setBusy(true);
    setMessage("Settings saved; the bridge is restarting and will reconnect when ready.");
    try {
      const result = await applyRemoteAccess(httpUrl, draft, passwordAction, password || undefined);
      applyObserved.current = result.state === "applying";
      setStatus((current) => current ? { ...current, apply: result } : current);
      if (result.state !== "applying") setBusy(false);
      setPassword("");
      setPasswordAction("keep");
      setMessage(result.reason ?? "Settings saved; waiting for the bridge to become ready.");
    } catch (error) {
      applyObserved.current = false;
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Could not apply remote access settings");
    }
  };

  const applyState = busy ? "applying" : status.apply.state;

  return (
    <div className="settings-section remote-access-settings">
      <div className="settings-label">Direct network access</div>
      <p className="settings-help">
        LAN/VPN access uses the existing direct HTTP and WebSocket bridge. It is not a firewall or
        source-address allow-list; use a VPN, SSH, or TLS for untrusted networks.
      </p>
      <div className="settings-row remote-access-toggle-row">
        <span>Allow direct network connections</span>
        <button
          className="backend-toggle"
          type="button"
          role="switch"
          aria-label="Allow direct network connections"
          aria-checked={draft.enabled}
          data-on={draft.enabled ? "true" : undefined}
          onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {!draft.enabled ? <p className="backend-note">This bridge is available only locally. Saved addresses remain available for later.</p> : null}

      <div className="remote-access-subsection">
        <strong>Accepted addresses</strong>
        {draft.accepted_hosts.length === 0 ? <span className="backend-note">None selected</span> : null}
        {draft.accepted_hosts.map((host) => (
          <div className="remote-access-chip" key={host}>
            <span>{host}</span>
            <button type="button" aria-label={`Remove ${host}`} onClick={() => setDraft({ ...draft, accepted_hosts: draft.accepted_hosts.filter((item) => item !== host) })}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {draft.enabled ? (
          <div className="remote-access-add-row">
            <input className="field" aria-label="Add address" placeholder="hostname or IP literal" value={addressInput} onChange={(event) => setAddressInput(event.target.value)} />
            <button type="button" className="btn" onClick={() => { if (addToList("accepted_hosts", addressInput)) setAddressInput(""); }}>Add address</button>
          </div>
        ) : null}
        {status.suggestions.filter((item) => !draft.accepted_hosts.includes(item)).map((suggestion) => (
          <label className="remote-access-suggestion" key={suggestion}>
            <input
              type="checkbox"
              checked={selectedSuggestions.includes(suggestion)}
              onChange={(event) => {
                setSelectedSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion));
                if (event.target.checked) addToList("accepted_hosts", suggestion);
                else setDraft((current) => current ? { ...current, accepted_hosts: current.accepted_hosts.filter((item) => item !== suggestion) } : current);
              }}
            />
            <span>{suggestion}</span>
            <small>Suggested address</small>
          </label>
        ))}
      </div>

      <div className="remote-access-subsection">
        <strong>Browser permissions</strong>
        <p className="settings-help">Allowed page origins protect calls into this bridge. Allowed bridge destinations control where this page may connect over HTTP/WebSocket.</p>
        <PermissionList
          label="Allowed page origins"
          values={draft.allowed_page_origins}
          suggestions={pageOriginSuggestions}
          input={pageOriginInput}
          onInput={setPageOriginInput}
          onChange={(values) => setDraft({ ...draft, allowed_page_origins: values })}
        />
        <PermissionList
          label="Allowed bridge destinations"
          values={draft.allowed_bridge_origins}
          suggestions={bridgeOriginSuggestions}
          input={bridgeOriginInput}
          onInput={setBridgeOriginInput}
          onChange={(values) => setDraft({ ...draft, allowed_bridge_origins: values })}
        />
      </div>

      {address ? (
        <div className="remote-access-address">
          <span>Connection URL</span>
          <code>{address}</code>
          <button type="button" className="btn" onClick={() => void copyValue(address)}><Copy size={13} /> Copy</button>
        </div>
      ) : null}

      <div className="remote-access-subsection">
        <strong>Password</strong>
        <span className="backend-note">{status.remote_access.password_configured ? "Protected" : "Not set"}</span>
        {draft.enabled ? <p className="backend-warning">Direct access uses unencrypted HTTP and WebSocket connections. A bridge password protects access, but does not protect passwords or session tokens from a network observer. Use TLS or a trusted VPN.</p> : null}
        {draft.enabled && !status.remote_access.password_configured ? <p className="backend-warning">Anyone who can reach an accepted address may connect until you set a password.</p> : null}
        <div className="remote-access-password-row">
          <input
            className="field"
            type="password"
            aria-label={status.remote_access.password_configured ? "Change bridge password" : "Set bridge password"}
            placeholder={status.remote_access.password_configured ? "New password" : "Set password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => { setPassword(event.target.value); setPasswordAction("set"); }}
          />
          {status.remote_access.password_configured ? <button type="button" className="btn btn-danger" onClick={() => { setPassword(""); setPasswordAction("remove"); setMessage("Password protection will be removed when you apply settings."); }}>Remove</button> : null}
        </div>
        {status.remote_access.password_configured ? <span className="backend-note">Enter a new password to change it, or Remove to disable protection.</span> : null}
      </div>

      <div className={`remote-access-apply remote-access-apply-${applyState}`} role="status">
        <strong>{busy ? "Settings saved; waiting to apply" : applyLabel(status.apply.state)}</strong>
        <span>{status.apply.reason ?? message ?? (status.mutation_allowed ? "Ready to apply." : status.mutation_reason ?? "Settings are read-only in this launch.")}</span>
      </div>
      {!status.mutation_allowed ? <p className="backend-warning">{status.mutation_reason ?? "This launch cannot safely apply settings."}</p> : null}
      {message && status.apply.state !== "applying" ? <div className="modal-message">{message}</div> : null}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !status.mutation_allowed} onClick={() => void save()}>{busy ? "Applying…" : "Apply"}</button>
      </div>
    </div>
  );
}

function PermissionList({ label, values, suggestions, input, onInput, onChange }: {
  label: string;
  values: string[];
  suggestions: string[];
  input: string;
  onInput: (value: string) => void;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="remote-access-permission-list">
      <span>{label}</span>
      {values.map((value) => <div className="remote-access-chip" key={value}><span>{value}</span><button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}><Trash2 size={13} /></button></div>)}
      {suggestions.filter((item) => !values.includes(item)).map((suggestion) => (
        <label className="remote-access-suggestion" key={suggestion}>
          <input type="checkbox" checked={false} onChange={(event) => { if (event.target.checked) onChange([...values, suggestion]); }} />
          <span>{suggestion}</span><small>Suggested</small>
        </label>
      ))}
      <div className="remote-access-add-row">
        <input className="field" aria-label={`Add ${label.toLowerCase()}`} placeholder="http(s)://host:port" value={input} onChange={(event) => onInput(event.target.value)} />
        <button type="button" className="btn" onClick={() => { const value = input.trim(); if (value && !values.includes(value)) { onChange([...values, value]); onInput(""); } }}><Plus size={13} /> Add</button>
      </div>
    </div>
  );
}

function draftFromStatus(status: RemoteAccessStatus): RemoteAccessDraft {
  return {
    enabled: status.remote_access.enabled,
    accepted_hosts: status.remote_access.accepted_hosts,
    allowed_page_origins: status.remote_access.allowed_page_origins,
    allowed_bridge_origins: status.remote_access.allowed_bridge_origins,
  };
}

function uniqueOrigins(values: readonly (string | undefined)[]) {
  const origins: string[] = [];
  for (const value of values) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.pathname === "/" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
        if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
      }
    } catch {
      // Suggestions are optional and untrusted profile values are ignored.
    }
  }
  return origins.slice(0, 8);
}

function applyLabel(state: RemoteAccessStatus["apply"]["state"]) {
  return state === "applying" ? "Service restarting" : state === "failed" ? "Apply failed" : "Bridge ready";
}

async function copyValue(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Copy is a convenience; the address remains selectable.
  }
}
