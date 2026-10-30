import {
  activityEntries,
  rememberActivity,
} from "../../../shared/agentActivity";
import { withCachedRecency } from "../agentRecency";
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
    snapshot.agentActivity,
    activityEntries(control.agents, true),
    snapshot.panes,
  );
  setForConnection(lease, {
    agentActivity,
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
