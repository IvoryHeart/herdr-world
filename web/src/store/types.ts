import {
  type EndpointAvailability,
  type EndpointAdvertisement,
} from "../endpointAvailability";
import type { AgentActivityMap } from "../../../shared/agentActivity";
import { type BrowserNavigation } from "../browserNavigation";
import {
  type AgentSessionIdentity,
  type Workspace,
  type Tab,
  type Pane,
  type PaneLayout,
} from "../types";
import {
  type PopupStatePush,
  type ConnectionStatus,
  type ConnectionSummary,
  type ConnectionClient,
} from "../api";
import { type TaskNotificationPreferences } from "../taskPush";

export interface ServerSessionState {
  /** ConnectionManager generation that owns every server resource below. */
  serverRuntimeGeneration: number | null;
  navigationMode: "browser-local" | "shared";
  tabMoveSupported: boolean;
  endpointAvailability: EndpointAvailability;
  /** Current browser attachment attempts; runtime advertisements are not ownership. */
  terminalAttachments: Record<
    string,
    {
      attempt: number;
      ready: boolean;
      advertisement?: EndpointAdvertisement | null;
    }
  >;
  browserNavigation: BrowserNavigation;
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  agentActivity: AgentActivityMap;
  layout: PaneLayout | null;
  selectedPaneId: string | null;
  recentPaneIds: string[];
  /** A plugin's session-modal floating pane (e.g. Herdr Float), if open. */
  popup: PopupInfo | null;
  error: string | null;
  pendingFocusWorkspaceId: string | null;
  pendingFocusWorkspaceSeq: number;
  pendingFocusWorkspaceSettledAt: number | null;
  terminalAttachEpoch: number;
  lastRefresh: number;
  /** Start time of the latest successfully observed focused topology list. */
  lastTopologyObservationStartedAt: number;
}

export type PopupInfo = NonNullable<PopupStatePush["popup"]>;

export type WorkspaceSourceTarget = Omit<TaskNotificationTarget, "paneId"> & {
  paneId?: string;
};

export interface State extends ServerSessionState {
  status: ConnectionStatus;
  connectionPaused: boolean;
  bridgeStatus: BridgeStatus | null;
  connections: ConnectionSummary[];
  /** A validated catalogue has been admitted on the current transport. */
  catalogueReady: boolean;
  defaultConnectionId: string;
  activeConnectionId: string;
  connectionGeneration: number;
  sessionsByConnectionId: Record<string, ServerSessionState>;
  /** Browser-only identity maxima, independent of service incarnation and operation leases. */
  agentActivityHistory?: Record<string, AgentActivityMap>;
  notice: Notice | null;
  taskNotificationsEnabled: boolean;
  taskNotificationPreferences: TaskNotificationPreferences;
  taskNotificationTransport: "local" | "push";
  taskNotificationBusy: boolean;
  taskNotificationPermission: NotificationPermission | "unsupported";
  automaticUpdateChecksEnabled: boolean;
  updateInfo: UpdateInfo | null;
  updateInstalling: boolean;
  herdrUpgrading: boolean;
  pendingRestartVersion: string | null;
  dismissedUpdateVersion: string | null;
}

export interface Notice {
  kind: "info" | "success" | "error";
  message: string;
  detail?: string;
  detailMode?: "text" | "output";
  detailTitle?: string;
  loading?: boolean;
  autoDismissMs?: number;
  actionLabel?: string;
  actionConnectionId?: string;
  actionRuntimeGeneration?: number;
  actionWorkspaceId?: string;
  actionPaneId?: string;
  actionAgentSessionId?: string;
  actionTerminalId?: string;
  actionRangerTaskId?: string;
  actionRangerRunId?: string;
  actionClipboardText?: string;
  id?: number;
}

export interface UpdateInfo {
  current_version: string;
  latest_version?: string;
  update_available: boolean;
  can_auto_update: boolean;
  reason?: string;
  platform: string;
  source_url?: string;
  metadata_url?: string;
}

export interface BridgeStatus {
  clients: number;
  terminals: Array<{
    terminal_id: string;
    viewers: number;
  }>;
}

export interface StoreConnectionLease {
  connectionId: string;
  generation: number;
  client: ConnectionClient;
}

export interface WorktreeRemovedTarget {
  connectionId: string;
  generation: number;
  workspace: Workspace;
}

export interface TaskNotificationTarget {
  terminalId?: string;
  agentSessionId?: string;
  connectionId: string;
  runtimeGeneration: number;
  workspaceId: string;
  paneId: string;
}

export interface QualifiedFocusTarget {
  terminalId?: string;
  /** Browser-only request cancellation; never sent to Herdr. */
  isCurrent?(): boolean;
  /** Browser-local intent captured before asynchronous notification admission. */
  navigationRevision?: number;
  agentSessionId?: string;
  /** Complete occupant identity retained across queued Desk admission. */
  agentSession?: AgentSessionIdentity;
  connectionId: string;
  runtimeGeneration: number;
  workspaceId: string;
  paneId: string | null;
}

export interface QualifiedRuntimeTarget {
  connectionId: string;
  runtimeGeneration: number;
}
