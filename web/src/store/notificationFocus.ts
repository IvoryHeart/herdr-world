import type { Pane } from "../types";
import type {
  QualifiedFocusTarget,
  StoreConnectionLease,
  TaskNotificationTarget,
} from "./types";

export type NotificationFocusOptions = {
  beforeFocus?(): void;
  activateConnection?: boolean;
};

/** The store supplies its existing lease, queue and selection operations. */
export async function focusTaskNotification(
  target: TaskNotificationTarget,
  options: NotificationFocusOptions,
  host: {
    targetIsCurrent(): boolean;
    captureLease(): StoreConnectionLease;
    navigationRevision(lease: StoreConnectionLease): number;
    isCurrent(lease: StoreConnectionLease): boolean;
    focus(target: QualifiedFocusTarget): Promise<boolean>;
    activate(connectionId: string): boolean;
    unavailable(): void;
  },
) {
  if (!host.targetIsCurrent()) {
    host.unavailable();
    return;
  }
  const lease = host.captureLease();
  const navigationRevision = host.navigationRevision(lease);
  if (
    !lease ||
    lease.client.serverRuntimeGeneration !== target.runtimeGeneration
  ) {
    host.unavailable();
    return;
  }
  try {
    const result = await lease.client.call("pane.get", {
      pane_id: target.paneId,
    });
    const pane = result?.pane as Pane | undefined;
    if (
      !host.isCurrent(lease) ||
      !pane ||
      pane.pane_id !== target.paneId ||
      pane.workspace_id !== target.workspaceId
    ) {
      host.unavailable();
      return;
    }
    if (target.agentSessionId) {
      const session = await lease.client.call("agent_session.get", {
        pane_id: target.paneId,
      });
      const identity = session?.session?.value ?? session?.agent_session?.value;
      if (!host.isCurrent(lease) || identity !== target.agentSessionId) {
        host.unavailable();
        return;
      }
    }
    options.beforeFocus?.();
    const admitted = await host.focus({
      connectionId: target.connectionId,
      runtimeGeneration: target.runtimeGeneration,
      workspaceId: target.workspaceId,
      paneId: target.paneId,
      agentSessionId: target.agentSessionId,
      navigationRevision,
    });
    if (!admitted) host.unavailable();
    else if (
      options.activateConnection &&
      !host.activate(target.connectionId)
    ) {
      host.unavailable();
      return false;
    }
    return admitted ? pane : false;
  } catch {
    host.unavailable();
    return;
  }
}
