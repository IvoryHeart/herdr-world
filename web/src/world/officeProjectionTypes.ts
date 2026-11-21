import type { AgentUsageStop } from "../../../shared/usageStop";
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
  appearance?: { status?: string; avatar?: string };
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
  /**
   * Set when Town shows the agent out of fuel: it stopped on a usage limit
   * (town/townOutOfFuel.ts), and its status is presented as idle.
   */
  usageStop?: AgentUsageStop;
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
  focused: boolean;
  destination: OfficeAgentDestination;
  placement: OfficeAgentPlacement;
  stale: boolean;
  canOpenInSpaces: boolean;
  /**
   * A live herdr-core agent World's Inspector opens (Chat, Terminal, Files,
   * Changes) though World only watches it.
   */
  coreChat?: boolean;
  /** Why World only watches this agent (herdr-core), and its own words. */
  /** `watch`: its terminal opens in the Inspector's Terminal tab. */
  viewOnly?: { reason: string; message: string; watch: boolean };
  /** herdr-core: seen and favourite, shared with Herdr's apps. */
  coreShared?: import("./coreShared").CoreShared;
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
  /**
   * A live herdr-core pane: Town opens it in World's Inspector (its
   * terminal, or an agent's Chat) though World cannot mark its work reviewed.
   */
  coreOpen?: true;
  /** Herdr reports this pane focused in its tab. */
  focused?: true;
  /** When the pane's agent last did something (epoch ms), if known. */
  lastActivityAt?: number;
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
  appearanceStatus?: string;
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
  /** Any of its panes is a live herdr-core pane Town opens (coreOpen). */
  coreOpen?: true;
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
  /**
   * Town only: the room's runtime ("Herdr TUI", "herdr-core") when its
   * building holds rooms of more than one runtime (townBuildings.ts).
   */
  runtimeTag?: string;
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
