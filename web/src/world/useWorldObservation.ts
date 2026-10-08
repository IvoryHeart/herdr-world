import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { bridge } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { shallowEqual, useStoreSelector } from "../store";
import { useWorldRuntime } from "./runtimeStore";
import {
  buildWorldObject,
  worldObjectForHosts,
  worldObjectForWatches,
  worldObjectWithWatches,
} from "./worldObject";
import { useWorldWatchlist, WorldWatchlistStore } from "./watchlistStore";
import { useHostsFilter } from "./hostsFilter";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  type OfficeInspectorPresentation,
} from "./officePreferences";
import { useMediaQuery } from "./DeskView";
import { hasValidSelectedConnection } from "./worldInspectorSelection";
import { type WorldControlPlaneProps } from "./worldControlPlaneContract";

type Input = Pick<WorldControlPlaneProps, "onPresentedWorldChange">;

export function useWorldObservation({ onPresentedWorldChange }: Input) {
  const runtime = useWorldRuntime();
  const watchlistStore = useMemo(() => new WorldWatchlistStore(bridge), []);
  const watchlist = useWorldWatchlist(watchlistStore);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const deskReadingPane = useMediaQuery("(min-width: 981px)");
  useEffect(() => {
    watchlistStore.start();
    return () => watchlistStore.stop();
  }, [watchlistStore]);
  const connectionSelection = useStoreSelector(
    (snapshot) => ({
      activeConnectionId: snapshot.activeConnectionId,
      connections: snapshot.connections,
      defaultConnectionId: snapshot.defaultConnectionId,
      runtimeGeneration: snapshot.serverRuntimeGeneration,
      status: snapshot.status,
      catalogueReady: snapshot.catalogueReady,
    }),
    shallowEqual,
  );
  const operationalSnapshot = useStoreSelector((snapshot) => snapshot);
  const hostsFilter = useHostsFilter(
    connectionSelection.connections.map((connection) => connection.id),
    connectionSelection.catalogueReady,
  );
  const hasSelectedConnection = hasValidSelectedConnection(
    connectionSelection.activeConnectionId,
    connectionSelection.connections,
  );
  const selectedWorldConnection = runtime.connections.find(
    (connection) =>
      connection.connectionId === connectionSelection.activeConnectionId,
  );
  const selectedWorldObservationActionable =
    selectedWorldConnection?.actionable ?? false;
  const aggregateWorld = useMemo(
    () =>
      buildWorldObject(
        runtime.connections,
        connectionSelection.activeConnectionId,
      ),
    [connectionSelection.activeConnectionId, runtime.connections],
  );
  const world = useMemo(
    () => worldObjectForHosts(aggregateWorld, hostsFilter.ids),
    [aggregateWorld, hostsFilter.ids],
  );
  const watchedWorld = useMemo(
    () => worldObjectWithWatches(world, watchlist.records),
    [watchlist.records, world],
  );
  const presentedWorld = useMemo(
    () =>
      pinnedOnly
        ? worldObjectForWatches(watchedWorld, watchlist.records)
        : watchedWorld,
    [pinnedOnly, watchedWorld, watchlist.records],
  );
  useLayoutEffect(
    () => onPresentedWorldChange(presentedWorld),
    [onPresentedWorldChange, presentedWorld],
  );
  const watchAdmissions = world.hosts.flatMap((host) =>
    host.connection.snapshot ? [host.connection.snapshot.watchAdmission] : [],
  );
  const unavailableWatchHosts = world.hosts.length - watchAdmissions.length;
  const unavailableWatchStatus = unavailableWatchHosts
    ? ` · ${unavailableWatchHosts} ${unavailableWatchHosts === 1 ? "host" : "hosts"} unavailable`
    : "";
  const watchCoverage = watchAdmissions.reduce(
    (counts, admission) => ({
      registered: counts.registered + (admission?.registered ?? 0),
      admitted: counts.admitted + (admission?.admitted ?? 0),
      missing: counts.missing + (admission?.missing ?? 0),
      unresolved: counts.unresolved + (admission?.unresolved ?? 0),
      admissionFailed:
        counts.admissionFailed + (admission?.admissionFailed ?? 0),
    }),
    {
      registered: 0,
      admitted: 0,
      missing: 0,
      unresolved: 0,
      admissionFailed: 0,
    },
  );
  const watchStatus =
    watchlist.error ??
    (!watchlist.verified
      ? "Watches unavailable while disconnected"
      : watchAdmissions.some(
            (admission) =>
              !admission || admission.revision !== watchlist.revision,
          )
        ? "Watch availability pending for filtered hosts"
        : `${watchCoverage.registered} pinned in filter · ${watchCoverage.admitted} admitted · ${watchCoverage.missing} missing · ${watchCoverage.unresolved} unresolved · ${watchCoverage.admissionFailed} not admitted${unavailableWatchStatus}`);
  const [officeInspectorPresentation, setOfficeInspectorPresentation] =
    useState<OfficeInspectorPresentation>(
      () => readOfficePreferences(worldLocalStorage).inspectorPresentation,
    );
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as
              | { inspectorPresentation?: OfficeInspectorPresentation }
              | undefined)
          : undefined;
      setOfficeInspectorPresentation(
        detail?.inspectorPresentation ??
          readOfficePreferences(worldLocalStorage).inspectorPresentation,
      );
    };
    window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(
        WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
        refresh,
      );
  }, []);
  return {
    runtime,
    watchlistStore,
    watchlist,
    pinnedOnly,
    setPinnedOnly,
    deskReadingPane,
    connectionSelection,
    operationalSnapshot,
    hostsFilter,
    hasSelectedConnection,
    selectedWorldConnection,
    selectedWorldObservationActionable,
    aggregateWorld,
    world,
    presentedWorld,
    watchStatus,
    officeInspectorPresentation,
  };
}

export type WorldObservation = ReturnType<typeof useWorldObservation>;
