import { bridge } from "../api";
import {
  state,
  set,
  store,
  nextCatalogRequest,
  applyConnectionCatalog,
  rearmTerminalAttachmentsAfterCatalog,
  catalogReadyForConnection,
} from "../store";
import { jsonDeepEqual } from "./sessions";
import type { BridgeStatus, State } from "./types";
import { parseCoreConnections } from "../coreConnections";
import { scheduleRefresh } from "./refresh";
import { sharedAcquisitionEnabled } from "./focusedInterest";

async function readBridgeStatus(): Promise<boolean> {
  if (state.connectionPaused || state.status !== "connected") return false;
  const requestSeq = nextCatalogRequest();
  const epoch = bridge.connectionEpoch;
  try {
    const r = await bridge.call("bridge.status");
    if (
      state.connectionPaused ||
      state.status !== "connected" ||
      epoch !== bridge.connectionEpoch
    )
      return false;
    const admitted = applyConnectionCatalog(r, requestSeq, epoch);
    if (rearmTerminalAttachmentsAfterCatalog(catalogReadyForConnection)) {
      scheduleRefresh();
    }
    const nextBridgeStatus: BridgeStatus = {
      clients: Number(r?.clients ?? 0),
      terminals: Array.isArray(r?.terminals) ? r.terminals : [],
    };
    if (!jsonDeepEqual(state.bridgeStatus, nextBridgeStatus)) {
      set({ bridgeStatus: nextBridgeStatus });
    }
    return admitted;
  } catch {
    // Keep the last good count while a failed request is retried.
    return false;
  }
}

type Flight = { epoch: number; queued: boolean; promise: Promise<boolean> };
let flight: Flight | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
const connected = () => state.status === "connected" && !state.connectionPaused;
const retryable = () =>
  connected() &&
  sharedAcquisitionEnabled() &&
  (typeof document === "undefined" || !document.hidden);
const cancelRetry = () => {
  clearTimeout(retry);
  retry = undefined;
};

/** All bridge.status triggers share one in-flight request and one successor. */
export function refreshBridgeStatus(): Promise<boolean> {
  if (!connected()) return Promise.resolve(false);
  if (!sharedAcquisitionEnabled()) return readBridgeStatus();
  const epoch = bridge.connectionEpoch;
  if (flight?.epoch === epoch) {
    flight.queued = true;
    return flight.promise;
  }
  cancelRetry();
  const request: Flight = {
    epoch,
    queued: false,
    promise: Promise.resolve(false),
  };
  flight = request;
  request.promise = readBridgeStatus().then((success) => {
    if (flight !== request) return false;
    flight = null;
    if (request.epoch !== bridge.connectionEpoch || !connected()) return false;
    if (request.queued) void refreshBridgeStatus();
    else if (!success && retryable())
      retry = setTimeout(() => {
        retry = undefined;
        if (retryable()) void refreshBridgeStatus();
      }, 5000);
    return success;
  });
  return request.promise;
}

export function installCatalogueRefresh(): void {
  const reconcile = () => {
    if (!retryable()) cancelRetry();
    if (!connected() || (flight && flight.epoch !== bridge.connectionEpoch))
      flight = null;
  };
  store.subscribe(reconcile);
  bridge.onHello(reconcile);
  bridge.onStatus(reconcile);
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", reconcile);
}

/**
 * The catalogue's herdr-core profiles without their observation (which changes
 * on every look and belongs to the Connections page), or undefined when they
 * are unchanged, so host lists keep their reference and do not re-render.
 */
export function changedCoreHosts(
  previous: State["coreConnections"],
  catalogue: unknown,
): State["coreConnections"] {
  const value = (catalogue as { core_connections?: unknown } | null)
    ?.core_connections;
  // A reply without the field (an older service) says nothing about core hosts.
  if (value === undefined) return undefined;
  const next = parseCoreConnections(value).map((connection) => {
    const profile: Partial<typeof connection> = { ...connection };
    delete profile.observation;
    return profile as NonNullable<State["coreConnections"]>[number];
  });
  return previous && jsonDeepEqual(previous, next) ? undefined : next;
}
