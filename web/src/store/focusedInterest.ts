import { bridge } from "../api";
import { state, store } from "../store";

/** Active-host interest is declarative; loading an inactive context does not hold it. */
export function startFocusedInterest(): void {
  let acknowledged: string | null = null;
  let pending: object | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failed: string | null = null;

  const cancelRetry = () => {
    clearTimeout(retry);
    retry = undefined;
    failed = null;
  };
  const sync = () => {
    if (
      state.status !== "connected" ||
      bridge.hello?.capabilities?.world_shared_acquisition !== true
    ) {
      acknowledged = null;
      cancelRetry();
      return;
    }
    const visible = typeof document === "undefined" || !document.hidden;
    const active =
      state.catalogueReady && !state.connectionPaused && visible
        ? state.connections.find(
            (owner) =>
              owner.id === state.activeConnectionId && owner.state === "ready",
          )
        : undefined;
    const owners = active
      ? [{ connection_id: active.id, connection_generation: active.generation }]
      : [];
    const epoch = bridge.connectionEpoch;
    const signature = JSON.stringify([epoch, owners]);
    if (
      signature === acknowledged ||
      pending ||
      (retry && failed === signature)
    )
      return;
    cancelRetry();
    const request = {};
    pending = request;
    void bridge
      .call("world.focused.observe", { owners })
      .then(
        () => {
          if (pending === request && epoch === bridge.connectionEpoch)
            acknowledged = signature;
        },
        () => {
          if (pending !== request || epoch !== bridge.connectionEpoch) return;
          failed = signature;
          retry = setTimeout(() => {
            retry = undefined;
            failed = null;
            sync();
          }, 5000);
        },
      )
      .finally(() => {
        if (pending !== request) return;
        pending = null;
        sync();
      });
  };

  store.subscribe(sync);
  bridge.onStatus((status) => {
    if (status !== "connected") {
      pending = null;
      acknowledged = null;
      cancelRetry();
    }
    sync();
  });
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", sync);
  sync();
}
