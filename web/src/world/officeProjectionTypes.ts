import type { WorldAgentStatus } from "./worldObject";

export type OfficeQualifiedTarget = {
  connectionId: string;
  generation: number;
  kind: "workspace" | "tab" | "pane" | "terminal";
  nativeId: string;
  worldId: string;
};

export type OfficeAgentDestination = "room" | "reception" | "bar";
export type OfficeAgentPlacement = "seated" | "standing" | "waiting" | "bar";

export type OfficeAgent = {
  key: string;
  nodeId: string;
  currentPaneRef: OfficeQualifiedTarget;
  currentTerminalRef: OfficeQualifiedTarget;
  currentTabRef: OfficeQualifiedTarget;
  deskKey: string | null;
  observedGeneration: number;
  roomKey: string;
  hostKey: string;
  displayLabel: string;
  /** The name Herdr gives the agent (agent.list), when it has one. */
  agentName?: string;
  /** Its harness ("claude", "codex"), which picks its artwork. */
  harness?: string;
  taskSummary?: string;
  semanticStatus: WorldAgentStatus;
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
  focused: boolean;
  destination: OfficeAgentDestination;
  placement: OfficeAgentPlacement;
  stale: boolean;
  canOpenInSpaces: boolean;
  characterIndex: number;
};

export type OfficePaneDevice = {
  key: string;
  nodeId: string;
  paneRef: OfficeQualifiedTarget;
  terminalRef: OfficeQualifiedTarget;
  deskKey: string;
  hostKey: string;
  roomKey: string;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  agentKey?: string;
  agentSessionFingerprint?: string;
};

export type OfficePaneRosterEntry = {
  device: OfficePaneDevice;
  roomLabel: string;
  deskLabel: string;
  hostLabel: string;
  presented: boolean;
};

export type OfficeDesk = {
  key: string;
  hostKey: string;
  roomKey: string;
  tabRef: OfficeQualifiedTarget;
  terminalSelectionKeys: string[];
  observedGeneration: number;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  occupantAgentKey?: string;
  completionAgentKeys: string[];
  paneDevices: OfficePaneDevice[];
  observedPaneCount: number;
  omittedPaneCount: number;
};

export type OfficeRoom = {
  key: string;
  hostKey: string;
  workspaceRef: OfficeQualifiedTarget;
  observedGeneration: number;
  displayLabel: string;
  accessibleLabel?: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  desks: OfficeDesk[];
  roomAgents: OfficeAgent[];
  omittedDeskCount: number;
  omittedAgentCount: number;
  observedDeskCount: number;
  observedAgentCount: number;
  deskRenderLimit: number;
  /** Current per-room reveal target; expansion survives closures until Fold. */
  deskFold?: "folded" | "expanded";
};

export type OfficeReception = {
  key: string;
  hostKey: string;
  hostLabel: string;
  stale: boolean;
  waitingAgents: OfficeAgent[];
  observedWaitingAgentCount: number;
  overflowCount: number;
};

export type OfficeRosterEntry = {
  agent: OfficeAgent;
  roomKey: string;
  roomLabel: string;
  hostKey: string;
  hostLabel: string;
  roomPresented: boolean;
  deskPresented: boolean;
  destinationPresented: boolean;
};

export type OfficeDeskRosterEntry = {
  desk: OfficeDesk;
  roomLabel: string;
  hostLabel: string;
  presented: boolean;
};

export type OfficeRoomRosterEntry = {
  key: string;
  hostKey: string;
  hostLabel: string;
  workspaceRef: OfficeQualifiedTarget;
  observedGeneration: number;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  presented: boolean;
};

export type OfficeCoverage = {
  configuredHosts: number;
  observedHosts: number;
  compatibleHosts: number;
  connectingHosts: number;
  staleHosts: number;
  observedWorkspaces: number;
  observedDesks: number;
  observedAgents: number;
  status: Record<WorldAgentStatus, number>;
  omittedRooms: number;
  omittedDesks: number;
  omittedRoomAgents: number;
  omittedReceptionDesks: number;
  omittedWaitingAgents: number;
  omittedBarAgents: number;
};
