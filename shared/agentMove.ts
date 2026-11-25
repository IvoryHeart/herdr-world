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
type AgentMoveDestination = {
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
  /**
   * The page's ID for this move. Sent again (with `follow`) after a lost
   * reply, it answers that move's outcome instead of starting another.
   */
  move_id?: string;
  follow?: boolean;
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
  | "native_refused"
  /** A followed move World has no record of (it restarted). */
  | "untracked";
export type AgentMoveOutcome =
  | { status: "moved"; target: AgentAddress }
  | { status: "refused"; reason?: AgentMoveRefusal; message: string }
  /** Nothing to resume: ask, then send again with `fresh`. */
  | { status: "confirm"; message: string }
  /** The new copy runs, but the original may still run too. */
  | { status: "uncertain"; target: AgentAddress; message: string };
