import type { ConnectionLifecycleState } from "./api";

export interface BridgeControlMsg {
  type:
    | "pause_connection"
    | "world_invalidated"
    | "world_watchlist_changed"
    | "world_completion_seen_changed"
    | "world_desk_changed"
    | "world_board_changed"
    | "world_ledger_changed"
    | "world_profiles_changed"
    | "agent_conversation_changed"
    | "world_agent_activity";
  agents?: unknown;
  connection_state?: ConnectionLifecycleState;
  reason?: string;
  pane_id?: string;
  connection_id?: string;
  connection_generation?: number;
  revision?: number;
  /** world_ledger_changed: a question was asked or answered. */
  asks?: boolean;
}
