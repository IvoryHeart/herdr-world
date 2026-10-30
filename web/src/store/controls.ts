import {
  activityEntries,
  rememberActivity,
} from "../../../shared/agentActivity";
import { rememberedRecency, withCachedRecency } from "../agentRecency";
import { bridge } from "../api";
import { startFocusedInterest } from "./focusedInterest";
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
  } else {
    handleAgentActivity(control);
  }
}

export function installStoreControls(): void {
  bridge.onControl(handleStoreControl);
  startFocusedInterest();
}
