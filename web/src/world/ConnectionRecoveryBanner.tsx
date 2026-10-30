import { useState } from "react";
import type { ConnectionLifecycleState } from "../api";
import { reconnectConnectionProfile } from "../connectionProfiles";
import "./connectionRecovery.css";

/** Reuse the existing profile recovery verb, always on the captured host ID. */
export async function reconnectCachedHost(
  connectionId: string,
  deps?: {
    call(method: string, params: Record<string, unknown>): Promise<unknown>;
    refresh(): Promise<unknown>;
  },
) {
  const call =
    deps?.call ??
    (async (method, params) =>
      (await import("../api")).bridge.call(method, params));
  const refresh =
    deps?.refresh ??
    (async () => {
      await (await import("../store")).store.refreshConnections();
      await (await import("./runtimeStore")).worldRuntimeStore.refresh();
    });
  try {
    await reconnectConnectionProfile({ connectionId, call });
  } finally {
    await refresh().catch(() => undefined);
  }
}

export function ConnectionRecoveryBanner({
  connectionId,
  label,
  state,
}: {
  connectionId: string;
  label: string;
  state?: ConnectionLifecycleState;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reconnect = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await reconnectCachedHost(connectionId);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="connection-recovery"
      role="status"
      data-connection-recovery={connectionId}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span>{state && state !== "ready" ? "Disconnected" : "Stale"} ·</span>
      <button
        type="button"
        disabled={busy}
        aria-label={`Reconnect ${label}`}
        onClick={() => void reconnect()}
      >
        {busy ? "Reconnecting…" : "Reconnect"}
      </button>
      {failed ? (
        <small>Reconnect failed. Open Manage connections for details.</small>
      ) : null}
    </div>
  );
}
