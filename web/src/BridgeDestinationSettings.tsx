import { useEffect, useMemo, useState } from "react";
import { AccessOriginList, uniqueHttpOrigins } from "./AccessOriginList";
import type { BridgeBackendProfile } from "./bridge";
import type { BridgeHttpUrl } from "./bridgeApi";
import {
  allowBridgeDestinations,
  applyRemoteAccess,
  fetchRemoteAccess,
  remoteAccessDraft,
  remoteAccessMatchesDraft,
  waitForRemoteAccessReady,
  type RemoteAccessStatus,
} from "./remoteAccess";

type Props = {
  httpUrl: BridgeHttpUrl;
  backends: readonly BridgeBackendProfile[];
  reloadPage?: () => void;
};

export function BridgeDestinationSettings({
  httpUrl,
  backends,
  reloadPage = () => window.location.reload(),
}: Props) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const savedOrigins = useMemo(
    () => uniqueHttpOrigins(backends.map((backend) => backend.baseUrl)),
    [backends],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchRemoteAccess(httpUrl).then((next) => {
      if (cancelled) return;
      setStatus(next);
      setDestinations(next.remote_access.allowed_bridge_origins);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Network permissions unavailable");
      }
    });
    return () => { cancelled = true; };
  }, [httpUrl]);

  const missingOrigins = status
    ? savedOrigins.filter((origin) => !status.remote_access.allowed_bridge_origins.includes(origin))
    : [];

  const applyAndReload = async (nextDestinations: string[]) => {
    if (!status) return;
    setBusy(true);
    setMessage("Applying network permissions…");
    try {
      const draft = remoteAccessDraft(status);
      draft.allowed_bridge_origins = nextDestinations;
      const apply = await applyRemoteAccess(httpUrl, draft, "keep");
      if (apply.state === "failed") {
        throw new Error(apply.reason ?? "This Herdr could not apply the network permissions");
      }
      await waitForRemoteAccessReady(
        httpUrl,
        apply.id,
        (next) => remoteAccessMatchesDraft(
          next,
          draft,
          status.remote_access.password_configured,
        ),
      );
      setMessage("Network permissions applied. Reloading Herdr World…");
      setBusy(false);
      reloadPage();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply network permissions");
      setBusy(false);
    }
  };

  const allowSaved = async () => {
    setBusy(true);
    setMessage("Allowing saved connections…");
    try {
      const result = await allowBridgeDestinations(httpUrl, savedOrigins);
      setStatus(result.status);
      setDestinations(result.status.remote_access.allowed_bridge_origins);
      if (result.changed) {
        setMessage("Saved connections allowed. Reloading Herdr World…");
        setBusy(false);
        reloadPage();
      } else {
        setMessage("All saved connections are already allowed.");
        setBusy(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not allow saved connections");
      setBusy(false);
    }
  };

  if (!status && !message) return null;

  return (
    <div className="settings-section bridge-destination-settings">
      {missingOrigins.length > 0 ? (
        <div className="bridge-destination-notice" role="status">
          <div>
            <strong>Connection permission needed</strong>
            <span>
              {missingOrigins.length === 1
                ? "One saved Herdr address is not yet available to this page."
                : `${missingOrigins.length} saved Herdr addresses are not yet available to this page.`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || status?.mutation_allowed !== true}
            onClick={() => void allowSaved()}
          >
            {busy ? "Applying…" : "Allow saved connections & reload"}
          </button>
        </div>
      ) : null}

      <details className="remote-access-advanced">
        <summary>Advanced network permissions</summary>
        <div className="remote-access-advanced-content">
          <p className="settings-help">
            These are the exact Herdr addresses this page may contact. Adding a connection allows
            its address automatically; changes require a reload because the browser keeps this
            security policy with the loaded page.
          </p>
          <AccessOriginList
            label="Herdrs this page may connect to"
            values={destinations}
            suggestions={savedOrigins}
            onChange={setDestinations}
          />
          <div className="remote-access-advanced-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || status?.mutation_allowed !== true}
              onClick={() => void applyAndReload(destinations)}
            >
              {busy ? "Applying…" : "Apply & reload"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={reloadPage}>
              Reload page
            </button>
          </div>
        </div>
      </details>

      {message ? <div className="modal-message">{message}</div> : null}
      {status && !status.mutation_allowed ? (
        <p className="backend-warning">
          {status.mutation_reason ?? "This launch cannot update network permissions."}
        </p>
      ) : null}
    </div>
  );
}
