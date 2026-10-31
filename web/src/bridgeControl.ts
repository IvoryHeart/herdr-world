import type { ConnectionLifecycleState } from "./api";
import type { DeskReadKind } from "../../shared/deskAcquisition";

export interface BridgeControlMsg {
  type:
    | "pause_connection"
    | "world_invalidated"
    | "world_watchlist_changed"
    | "world_completion_seen_changed"
    | "world_desk_changed"
    | "world_board_changed"
    | "world_ledger_changed"
    | "world_ask_delivery_changed"
    | "world_profiles_changed"
    | "agent_conversation_changed"
    | "world_agent_activity"
    | "world_focused_changed"
    | "world_connections_changed"
    | "world_desk_reads";
  /** Answer delivery revisions belong to one service lifetime. */
  incarnation?: string;
  kind?: DeskReadKind;
  session?: string | null;
  trigger?: string | null;
  result?: unknown;
  error?: string;
  failures?: number;
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
