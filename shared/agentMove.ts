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
  /** Confirmed: start it fresh there when nothing can be resumed. */
  fresh?: boolean;
};
/** Why a move was refused (the message says it in plain words). */
export type AgentMoveRefusal =
  | "busy"
  | "gone"
  | "changed"
  | "split"
  | "children"
  | "settling"
  | "moving"
  | "reconnected"
  | "other_machine"
  | "start_failed"
  | "close_failed"
  | "resume_failed"
  | "native_refused";
export type AgentMoveOutcome =
  | { status: "moved"; target: AgentAddress }
  | { status: "refused"; reason?: AgentMoveRefusal; message: string }
  /** Nothing to resume: ask, then send again with `fresh`. */
  | { status: "confirm"; message: string }
  /** The new copy runs, but the original may still run too. */
  | { status: "uncertain"; target: AgentAddress; message: string };
