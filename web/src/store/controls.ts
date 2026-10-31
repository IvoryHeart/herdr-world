import {
  activityEntries,
  rememberActivity,
} from "../../../shared/agentActivity";
import { rememberedRecency, withCachedRecency } from "../agentRecency";
import { bridge } from "../api";
import { refreshBridgeStatus, installCatalogueRefresh } from "./catalogue";
import { scheduleRefresh } from "./refresh";
import {
  startFocusedInterest,
  sharedAcquisitionEnabled,
} from "./focusedInterest";
import type { BridgeControlMsg } from "../bridgeControl";
import {
  store,
  state,
  captureConnectionLease,
  leaseSnapshot,
  setForConnection,
} from "../store";

function handleAgentActivity(control: BridgeControlMsg): void {
  if (
    control.type !== "world_agent_activity" ||
    state.connectionPaused ||
    bridge.hello?.capabilities?.world_shared_acquisition !== true ||
    !Array.isArray(control.agents)
  )
    return;
  const owner = state.connections.find(
    (connection) =>
      connection.id === control.connection_id &&
      connection.state === "ready" &&
      connection.generation === control.connection_generation,
  );
  if (!owner) return;
  const lease = captureConnectionLease(owner.id),
    snapshot = leaseSnapshot(lease);
  const agentActivity = rememberActivity(
    rememberedRecency(
      owner.id,
      snapshot.agentActivity,
      state.agentActivityHistory,
    ),
    activityEntries(control.agents, true),
  );
  setForConnection(lease, {
    agentActivity,
    agentActivityHistory: {
      ...state.agentActivityHistory,
      [owner.id]: agentActivity,
    },
    panes: withCachedRecency(snapshot.panes, agentActivity),
  });
}

export function handleStoreControl(control: BridgeControlMsg): void {
  if (control.type === "pause_connection") {
    store.pauseConnection(
      control.reason ??
        "Another Herdr World client paused this connection. Resume when you want this browser to sync again.",
    );
  } else if (
    sharedAcquisitionEnabled() &&
    !state.connectionPaused &&
    control.type === "world_connections_changed"
  ) {
    if (Number.isSafeInteger(control.revision) && control.revision! >= 0)
      void refreshBridgeStatus();
  } else if (
    sharedAcquisitionEnabled() &&
    !state.connectionPaused &&
    control.type === "world_focused_changed"
  ) {
    if (
      state.catalogueReady &&
      state.connections.some(
        (owner) =>
          owner.id === control.connection_id &&
          owner.generation === control.connection_generation &&
          owner.state === "ready",
      )
    )
      scheduleRefresh(captureConnectionLease(control.connection_id));
  } else {
    handleAgentActivity(control);
  }
}

export function installStoreControls(): void {
  bridge.onControl(handleStoreControl);
  startFocusedInterest();
  installCatalogueRefresh();
}
