import { bridge } from "../api";
import { state, store, captureConnectionLease, leaseIsCurrent } from "../store";
import { refreshNow, scheduleRefresh } from "./refresh";
import type { StoreConnectionLease } from "./types";

export type FocusedOwner = {
  connection_id: string;
  connection_generation: number;
};
const holds = new Map<object, FocusedOwner>();
const readRetries = new Map<string, ReturnType<typeof setTimeout>>();
let synchronize = () => {};
const keyOf = (owner: FocusedOwner) =>
  JSON.stringify([owner.connection_id, owner.connection_generation]);
export const sharedAcquisitionEnabled = () =>
  state.status === "connected" &&
  bridge.hello?.capabilities.world_shared_acquisition === true;
const visible = () => typeof document === "undefined" || !document.hidden;

/** Interest is observation only: it cannot admit or wake a runtime. */
function currentOwners(): Map<string, FocusedOwner> {
  const owners = new Map<string, FocusedOwner>();
  if (
    !sharedAcquisitionEnabled() ||
    !visible() ||
    state.connectionPaused ||
    !state.catalogueReady
  )
    return owners;
  const candidates = [...holds.values()];
  const active = state.connections.find(
    (owner) => owner.id === state.activeConnectionId && owner.state === "ready",
  );
  if (active)
    candidates.push({
      connection_id: active.id,
      connection_generation: active.generation,
    });
  for (const owner of candidates)
    if (
      state.connections.some(
        (entry) =>
          entry.id === owner.connection_id &&
          entry.generation === owner.connection_generation &&
          entry.state === "ready",
      )
    )
      owners.set(keyOf(owner), owner);
  return owners;
}

/** Every Inspector admission owns its own reference, even on an already-held host. */
export function holdFocusedOwner(owner: FocusedOwner): () => void {
  const token = {};
  holds.set(token, owner);
  synchronize();
  return () => {
    if (holds.delete(token)) synchronize();
  };
}

/** Return-to-page/focus catch-up observes every held owner. */
export function refreshHeldOwners(): void {
  for (const owner of currentOwners().values())
    scheduleRefresh(captureConnectionLease(owner.connection_id));
}

/** A successful read leaves no timer; failed held reads retry only while eligible. */
export function recordFocusedRead(
  lease: StoreConnectionLease,
  success: boolean,
): void {
  const owner = {
    connection_id: lease.connectionId,
    connection_generation:
      lease.client.serverRuntimeGeneration ?? lease.generation,
  };
  const key = keyOf(owner);
  if (success || !leaseIsCurrent(lease) || !currentOwners().has(key)) {
    clearTimeout(readRetries.get(key));
    readRetries.delete(key);
    return;
  }
  if (readRetries.has(key)) return;
  readRetries.set(
    key,
    setTimeout(() => {
      readRetries.delete(key);
      if (leaseIsCurrent(lease) && currentOwners().has(key))
        void refreshNow(lease);
    }, 5000),
  );
}

export function startFocusedInterest(): void {
  let acknowledged: string | null = null,
    pending: object | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined,
    failed: string | null = null;
  let epoch = -1;
  let admitted = new Set<string>(),
    seenHolds = new Set<object>();
  const cancelRetry = () => {
    clearTimeout(retry);
    retry = undefined;
    failed = null;
  };
  const sync = () => {
    const owners = currentOwners();
    for (const [key, timer] of readRetries)
      if (!owners.has(key)) {
        clearTimeout(timer);
        readRetries.delete(key);
      }
    if (epoch !== bridge.connectionEpoch || !sharedAcquisitionEnabled()) {
      epoch = bridge.connectionEpoch;
      acknowledged = null;
      pending = null;
      cancelRetry();
      admitted.clear();
      seenHolds.clear();
    }
    const fresh = new Map([...owners].filter(([key]) => !admitted.has(key)));
    const nextHolds = new Set<object>();
    for (const [token, owner] of holds)
      if (owners.has(keyOf(owner))) {
        nextHolds.add(token);
        if (!seenHolds.has(token)) fresh.set(keyOf(owner), owner);
      }
    admitted = new Set(owners.keys());
    seenHolds = nextHolds;
    for (const owner of fresh.values())
      scheduleRefresh(captureConnectionLease(owner.connection_id));
    if (!sharedAcquisitionEnabled()) return;
    const declared = [...owners.values()].sort((a, b) =>
      a.connection_id.localeCompare(b.connection_id),
    );
    const signature = JSON.stringify([epoch, declared]);
    if (
      signature === acknowledged ||
      pending ||
      (retry && failed === signature)
    )
      return;
    cancelRetry();
    acknowledged = null;
    const request = {},
      started = epoch;
    pending = request;
    void bridge
      .call("world.focused.observe", { owners: declared })
      .then(
        () => {
          if (pending === request && started === bridge.connectionEpoch)
            acknowledged = signature;
        },
        () => {
          if (pending !== request || started !== bridge.connectionEpoch) return;
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
  synchronize = sync;
  store.subscribe(sync);
  bridge.onStatus(sync);
  bridge.onHello(sync);
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", sync);
  sync();
}
