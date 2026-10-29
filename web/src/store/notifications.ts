import {
  type Notice,
  type TaskNotificationTarget,
  type State,
  type StoreConnectionLease,
} from "./types";
import {
  askClosed,
  askerName,
  sharedAsksStore,
  type WorldAsk,
} from "../world/worldAsks";
import { worldLocalStorage } from "../browserStorage";
import { type TaskNotificationPreferences } from "../taskPush";
import { type Pane, type Workspace, type Tab } from "../types";
import {
  type NotificationTarget,
  showTaskNotification,
  type RangerTaskNotificationTarget,
} from "../taskNotifications";
import {
  state,
  taskNotificationPreferenceVersion,
  reportTaskNotificationFailure,
  set,
  leaseIsCurrent,
} from "../store";
import { connectionSnapshot } from "./sessions";
import { announceChange, burstDetail } from "../chimes/chimeCenter";
import { bridge } from "../api";
import { type HerdrTaskNotification } from "../herdrTaskNotification";
import { type AssistantTaskNotification } from "../../../shared/assistant";

const TASK_NOTIFICATIONS_KEY = "taskNotificationsEnabled";
const TASK_NOTIFICATION_PREFERENCES_KEY = "taskNotificationPreferences";
export const DEFAULT_NOTICE_AUTO_DISMISS_MS = 15 * 1000;
const TASK_COMPLETED_TOAST_DISMISS_MS = DEFAULT_NOTICE_AUTO_DISMISS_MS;

export const TASK_NOTIFICATION_ACTIVATE_EVENT =
  "herdr-world:task-notification-activate";

export function noticeAutoDismissDelay(notice: Notice): number | null {
  if (notice.loading) return null;
  return notice.autoDismissMs ?? DEFAULT_NOTICE_AUTO_DISMISS_MS;
}

type ClickableNotification = Pick<Notification, "close" | "onclick">;

export function isTaskNotificationTarget(
  value: unknown,
): value is TaskNotificationTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<TaskNotificationTarget>;
  return (
    typeof target.connectionId === "string" &&
    target.connectionId.length > 0 &&
    typeof target.runtimeGeneration === "number" &&
    Number.isSafeInteger(target.runtimeGeneration) &&
    target.runtimeGeneration >= 0 &&
    typeof target.workspaceId === "string" &&
    target.workspaceId.length > 0 &&
    typeof target.paneId === "string" &&
    target.paneId.length > 0 &&
    (target.terminalId === undefined ||
      (typeof target.terminalId === "string" &&
        target.terminalId.length > 0)) &&
    (target.agentSessionId === undefined ||
      (typeof target.agentSessionId === "string" &&
        target.agentSessionId.length > 0))
  );
}

/** Connect a system notification click to the in-app pane navigation path. */
export function bindTaskNotificationActivation(
  notification: ClickableNotification,
  target: TaskNotificationTarget,
  activate: (target: TaskNotificationTarget) => void = (nextTarget) => {
    window.dispatchEvent(
      new CustomEvent<TaskNotificationTarget>(
        TASK_NOTIFICATION_ACTIVATE_EVENT,
        {
          detail: nextTarget,
        },
      ),
    );
  },
  focusWindow: () => void = () => window.focus(),
) {
  notification.onclick = () => {
    try {
      notification.close();
    } catch {
      // Notification cleanup must not block navigation.
    }
    try {
      focusWindow();
    } catch {
      // Browsers may deny focus even for a notification click.
    }
    activate(target);
  };
}

function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

function storedTaskNotificationsEnabled() {
  return (
    typeof localStorage !== "undefined" &&
    worldLocalStorage.getItem(TASK_NOTIFICATIONS_KEY) === "true"
  );
}

function storedTaskNotificationPreferences(): TaskNotificationPreferences {
  try {
    const stored = JSON.parse(
      worldLocalStorage.getItem(TASK_NOTIFICATION_PREFERENCES_KEY) ?? "{}",
    );
    return {
      completed: stored.completed !== false,
      blocked: stored.blocked !== false,
    };
  } catch {
    return { completed: true, blocked: true };
  }
}
type PaneStatusTracker = {
  ready: boolean;
  byId: Map<string, { status: string; identity: string }>;
};

export class TaskCompletionTracker {
  private readonly byConnection = new Map<string, PaneStatusTracker>();

  clear(): void {
    this.byConnection.clear();
  }

  reset(connectionId: string): void {
    this.byConnection.delete(connectionId);
  }

  update(connectionId: string, panes: Pane[]): Pane[] {
    const tracker = this.byConnection.get(connectionId) ?? {
      ready: false,
      byId: new Map<string, { status: string; identity: string }>(),
    };
    this.byConnection.set(connectionId, tracker);
    const livePaneIds = new Set<string>();
    const completed: Pane[] = [];
    for (const pane of panes) {
      livePaneIds.add(pane.pane_id);
      const nextStatus = pane.agent_status;
      const previous = tracker.byId.get(pane.pane_id);
      const identity = JSON.stringify([
        pane.workspace_id,
        pane.tab_id,
        pane.agent,
        pane.agent_session?.value,
      ]);
      if (
        tracker.ready &&
        previous?.identity === identity &&
        previous.status === "working" &&
        (nextStatus === "done" ||
          nextStatus === "idle" ||
          nextStatus === "blocked")
      ) {
        completed.push(pane);
      }
      tracker.byId.set(pane.pane_id, { status: nextStatus, identity });
    }
    for (const paneId of tracker.byId.keys()) {
      if (!livePaneIds.has(paneId)) tracker.byId.delete(paneId);
    }
    tracker.ready = true;
    return completed;
  }
}

const taskCompletionTracker = new TaskCompletionTracker();

function taskNotificationBody(
  pane: Pane,
  workspaces: Workspace[],
  tabs: Tab[],
) {
  const workspace = workspaces.find(
    (w) => w.workspace_id === pane.workspace_id,
  );
  const tab = tabs.find((t) => t.tab_id === pane.tab_id);
  const parts = [
    pane.agent ?? "Agent",
    workspace?.label ? `workspace ${workspace.label}` : null,
    tab?.label ? `tab ${tab.label}` : null,
  ].filter((part): part is string => !!part);
  return parts.join(" · ");
}

function maybeShowBrowserTaskNotification(
  title: string,
  body: string,
  tag: string,
  scope: Pick<
    TaskNotificationTarget,
    "connectionId" | "runtimeGeneration"
  > | null,
  target: NotificationTarget | null,
  /** World plays its own chime on this page, so the OS stays quiet. */
  silent = false,
  localEvent = false,
) {
  if (
    !state.taskNotificationsEnabled ||
    state.taskNotificationBusy ||
    (state.taskNotificationTransport === "push" && !localEvent)
  )
    return;
  const version = taskNotificationPreferenceVersion;
  if (notificationPermission() !== "granted") return;
  void showTaskNotification(
    title,
    { body, tag, ...(silent ? { silent: true } : {}) },
    target,
    () =>
      state.taskNotificationsEnabled &&
      version === taskNotificationPreferenceVersion &&
      (scope === null || taskNotificationTargetIsCurrent(state, scope)),
  ).catch((error) => reportTaskNotificationFailure(error, version));
}

export function taskNotificationTarget(
  connectionId: string,
  runtimeGeneration: number,
  pane: Pick<Pane, "workspace_id" | "pane_id">,
): TaskNotificationTarget {
  const metadata = pane as typeof pane & {
    agent_session?: { value?: unknown };
  };
  const session = metadata.agent_session?.value;
  return {
    ...(typeof session === "string" && session
      ? { agentSessionId: session }
      : {}),
    connectionId,
    runtimeGeneration,
    workspaceId: pane.workspace_id,
    paneId: pane.pane_id,
  };
}

export function taskNotificationTargetIsCurrent(
  snapshot: Pick<State, "connections">,
  target: Pick<TaskNotificationTarget, "connectionId" | "runtimeGeneration">,
): boolean {
  return snapshot.connections.some(
    (connection) =>
      connection.id === target.connectionId &&
      connection.state === "ready" &&
      connection.generation === target.runtimeGeneration,
  );
}

export function taskNotificationTag(target: TaskNotificationTarget): string {
  return JSON.stringify([
    "herdr-world-task",
    target.connectionId,
    target.runtimeGeneration,
    target.paneId,
  ]);
}

export function taskNotificationTargetFromNotice(
  notice: Pick<
    Notice,
    | "actionConnectionId"
    | "actionRuntimeGeneration"
    | "actionWorkspaceId"
    | "actionPaneId"
    | "actionAgentSessionId"
    | "actionTerminalId"
  >,
): TaskNotificationTarget | null {
  const target = {
    connectionId: notice.actionConnectionId,
    runtimeGeneration: notice.actionRuntimeGeneration,
    workspaceId: notice.actionWorkspaceId,
    paneId: notice.actionPaneId,
    ...(notice.actionTerminalId ? { terminalId: notice.actionTerminalId } : {}),
    ...(notice.actionAgentSessionId
      ? { agentSessionId: notice.actionAgentSessionId }
      : {}),
  };
  return isTaskNotificationTarget(target) ? target : null;
}

function notifyTaskCompleted(
  pane: Pane,
  workspaces: Workspace[],
  tabs: Tab[],
  connectionId = state.activeConnectionId,
) {
  const blocked = pane.agent_status === "blocked";
  const notify =
    state.taskNotificationsEnabled &&
    state.taskNotificationPreferences[blocked ? "blocked" : "completed"];
  const runtimeGeneration = connectionSnapshot(
    state,
    connectionId,
  ).serverRuntimeGeneration;
  if (runtimeGeneration === null) return;
  const body = taskNotificationBody(pane, workspaces, tabs);
  const announcement = announceChange({
    kind: blocked ? "blocked" : "completed",
    connectionId,
    terminalId: pane.terminal_id || null,
    agent: pane.display_agent ?? pane.agent ?? null,
    detail: null,
  });
  // A chime always comes with its toast; the OS notification keeps its switch.
  if (!notify && !announcement.chimed) return;
  const title = announcement.message;
  const target = taskNotificationTarget(connectionId, runtimeGeneration, pane);
  const sessionKnown = !pane.agent || Boolean(target.agentSessionId);
  const detail = sessionKnown
    ? body
    : `${body} · Original agent session identity is unavailable; this notification cannot navigate to a replacement.`;
  set({
    notice: {
      kind: blocked ? "info" : "success",
      message: announcement.message,
      detail: burstDetail(announcement, detail),
      ...(sessionKnown
        ? {
            actionLabel: pane.agent ? "Open agent" : "Open workspace",
            actionConnectionId: connectionId,
            actionRuntimeGeneration: runtimeGeneration,
            actionWorkspaceId: pane.workspace_id,
            actionPaneId: pane.pane_id,
            actionAgentSessionId: target.agentSessionId,
          }
        : {}),
      autoDismissMs: TASK_COMPLETED_TOAST_DISMISS_MS,
    },
  });
  if (notify)
    maybeShowBrowserTaskNotification(
      title,
      burstDetail(announcement, detail),
      taskNotificationTag(target),
      target,
      sessionKnown ? target : null,
      announcement.silent,
    );
}

/** True when the bridge relays Herdr's notification decisions. */
export function herdrTaskNotificationsActive(hello = bridge.hello): boolean {
  return hello?.capabilities?.herdr_task_notifications === true;
}

function documentIsVisible() {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

/**
 * New ledger asks use the existing chime, toast and OS-notification policy,
 * naming the asker (marked when unverified) with the question's first line.
 * An ask World cannot place on a terminal stays in the Needs you list only.
 */
export function notifyWorldAsk(ask: WorldAsk) {
  const actor = ask.actor;
  if (
    !actor.connection_id ||
    !actor.pane_id ||
    !actor.workspace_id ||
    !actor.terminal_id ||
    !Number.isSafeInteger(actor.connection_generation) ||
    askClosed(ask)
  )
    return;
  const line = ask.question.split("\n", 1)[0]!.trim();
  const question = line.length > 200 ? `${line.slice(0, 199)}…` : line;
  notifyHerdrTask(
    actor.connection_id,
    {
      kind: "message",
      title: question,
      body: question,
      agent: `${askerName(ask)}${actor.verified ? "" : " (unverified)"}`,
      agentKnown: true,
      sender: actor.agent
        ? { known: true, agent: actor.agent }
        : { known: false },
      workspaceId: actor.workspace_id,
      paneId: actor.pane_id,
      ...(actor.agent_session_id
        ? { agentSessionId: actor.agent_session_id }
        : actor.agent
          ? { sessionIdentityUnavailable: true as const }
          : {}),
    },
    actor.connection_generation,
    actor.terminal_id,
  );
}

function notifyHerdrTask(
  connectionId: string,
  notification: HerdrTaskNotification,
  askGeneration?: number,
  askTerminalId?: string,
) {
  // A message for the owner follows the completed switch, as before.
  const notify =
    state.taskNotificationsEnabled &&
    state.taskNotificationPreferences[
      notification.kind === "message" ? "completed" : notification.kind
    ];
  const snapshot = connectionSnapshot(state, connectionId);
  const runtimeGeneration = askGeneration ?? snapshot.serverRuntimeGeneration;
  if (
    runtimeGeneration === null ||
    (askGeneration !== undefined &&
      !taskNotificationTargetIsCurrent(state, {
        connectionId,
        runtimeGeneration,
      }))
  )
    return;
  const { workspaceId, paneId } = notification;
  // Someone looking at the pane already sees it; Herdr stays the policy owner.
  if (
    paneId &&
    connectionId === state.activeConnectionId &&
    paneId === activePaneIdForTaskNotifications(state) &&
    documentIsVisible()
  )
    return;
  const scope = { connectionId, runtimeGeneration };
  const target =
    workspaceId && paneId && !notification.sessionIdentityUnavailable
      ? {
          ...taskNotificationTarget(connectionId, runtimeGeneration, {
            workspace_id: workspaceId,
            pane_id: paneId,
            ...(notification.agentSessionId
              ? { agent_session: { value: notification.agentSessionId } }
              : {}),
          }),
          ...(askTerminalId ? { terminalId: askTerminalId } : {}),
        }
      : null;
  // The reason line carries a message's title; Herdr's body follows it.
  const message = notification.kind === "message";
  const text = notification.body ?? (message ? "" : notification.title);
  const detail = notification.sessionIdentityUnavailable
    ? `${text} · Original agent session identity is unavailable; this notification cannot navigate to a replacement.`
    : text;
  const pane = paneId
    ? snapshot.panes.find((candidate) => candidate.pane_id === paneId)
    : undefined;
  const announcement = announceChange({
    kind: notification.kind,
    connectionId,
    terminalId: askTerminalId ?? pane?.terminal_id ?? null,
    agent: notification.agentKnown ? notification.agent : null,
    // Without a pane, Herdr's title is all that says what it is.
    detail: message || !paneId ? notification.title : null,
  });
  // A chime always comes with its toast; the OS notification keeps its switch.
  if (!notify && !announcement.chimed) return;
  const blocked = notification.kind === "blocked";
  set({
    notice: {
      kind: blocked ? "info" : "success",
      message: announcement.message,
      detail: burstDetail(announcement, detail),
      ...(target
        ? {
            actionLabel: "Open agent",
            actionConnectionId: connectionId,
            actionRuntimeGeneration: runtimeGeneration,
            actionWorkspaceId: target.workspaceId,
            actionPaneId: target.paneId,
            actionAgentSessionId: target.agentSessionId,
            ...(target.terminalId
              ? { actionTerminalId: target.terminalId }
              : {}),
          }
        : {}),
      autoDismissMs: TASK_COMPLETED_TOAST_DISMISS_MS,
    },
  });
  if (notify)
    maybeShowBrowserTaskNotification(
      announcement.message,
      burstDetail(announcement, detail),
      target
        ? taskNotificationTag(target)
        : JSON.stringify([
            "herdr-world-task",
            connectionId,
            runtimeGeneration,
            notification.title,
          ]),
      scope,
      target,
      announcement.silent,
      askGeneration !== undefined,
    );
}

function notifyRangerTask(notification: AssistantTaskNotification) {
  const kind = notification.status === "succeeded" ? "completed" : "blocked";
  if (
    !state.taskNotificationsEnabled ||
    !state.taskNotificationPreferences[kind]
  )
    return;
  const target: RangerTaskNotificationTarget = {
    type: "ranger_task",
    taskId: notification.task_id,
    runId: notification.run_id,
  };
  set({
    notice: {
      kind:
        notification.status === "failed"
          ? "error"
          : notification.status === "succeeded"
            ? "success"
            : "info",
      message: notification.title,
      detail: notification.body,
      actionLabel: "Open Ranger task",
      actionRangerTaskId: target.taskId,
      actionRangerRunId: target.runId,
      autoDismissMs: TASK_COMPLETED_TOAST_DISMISS_MS,
    },
  });
  maybeShowBrowserTaskNotification(
    notification.title,
    notification.body,
    JSON.stringify(["roamgate-ranger-task", target.taskId, target.runId]),
    null,
    target,
  );
}

function activePaneIdForTaskNotifications(snapshot: State) {
  const layoutPaneIds = new Set(
    snapshot.layout?.panes.map((pane) => pane.pane_id) ?? [],
  );
  if (snapshot.selectedPaneId && layoutPaneIds.has(snapshot.selectedPaneId)) {
    return snapshot.selectedPaneId;
  }
  return (
    snapshot.layout?.focused_pane_id ??
    snapshot.panes.find((pane) => pane.focused)?.pane_id ??
    null
  );
}

function trackTaskCompletions(connectionId: string, panes: Pane[]) {
  return taskCompletionTracker.update(connectionId, panes);
}

function notifyCompletedTasks(
  lease: StoreConnectionLease,
  completed: Pane[],
  workspaces: Workspace[],
  tabs: Tab[],
) {
  if (!leaseIsCurrent(lease)) return;
  // The bridge relays Herdr's own notifications instead; see notifyHerdrTask.
  if (herdrTaskNotificationsActive()) return;
  const activePaneId = activePaneIdForTaskNotifications(state);
  for (const pane of completed) {
    if (!leaseIsCurrent(lease)) return;
    if (
      lease.connectionId === state.activeConnectionId &&
      pane.pane_id === activePaneId
    )
      continue;
    notifyTaskCompleted(pane, workspaces, tabs, lease.connectionId);
  }
}
export {
  TASK_NOTIFICATIONS_KEY,
  TASK_NOTIFICATION_PREFERENCES_KEY,
  notificationPermission,
  storedTaskNotificationsEnabled,
  storedTaskNotificationPreferences,
  taskCompletionTracker,
  notifyHerdrTask,
  notifyRangerTask,
  trackTaskCompletions,
  notifyCompletedTasks,
};

// Install policy without starting reads; the asks model never imports this module.
sharedAsksStore(notifyWorldAsk);
