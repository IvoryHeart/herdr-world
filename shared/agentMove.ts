/** Exact runtime addresses used only after service-owned move admission. */
export type AgentAddress = {
  connection_id: string;
  generation: number;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  terminal_id: string;
  color_key: string;
};
export type AgentMoveDestination = {
  connection_id: string;
  generation: number;
  workspace_id: string;
  cwd?: string;
};
export type AgentMoveRequest = {
  source: AgentAddress;
  destination: AgentMoveDestination;
};
export type AgentMoveOutcome =
  | { status: "moved"; target: AgentAddress }
  | { status: "refused"; message: string }
  /** The new copy runs, but the original may still run too. */
  | { status: "uncertain"; target: AgentAddress; message: string };
