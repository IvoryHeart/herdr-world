import type { ServerWebSocket } from "bun";
import type {
  ConnectionRpcRequest,
  resolveRpcRoute,
} from "../connections/rpc-routing";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { RpcServices } from "../index";

export type { RpcServices };

type RpcRoute = ReturnType<typeof resolveRpcRoute<LegacyConnectionRuntime>>;

/**
 * What one browser RPC hands to a namespace handler (see index.ts handleRpc).
 * Handlers return false synchronously when no branch matches, so dispatch
 * never yields before entering the matching handler on the captured runtime.
 */
export type BridgeRpcContext = {
  ws: ServerWebSocket<unknown>;
  req: ConnectionRpcRequest;
  id: string;
  method: string;
  params: ConnectionRpcRequest["params"];
  route: RpcRoute;
  connectionId: string | null;
  requestIsCurrent: () => boolean;
  sendReply: (message: Record<string, unknown>, context: string) => boolean;
  sendError: (context: string, error: unknown) => void;
  services: RpcServices;
};

/** A request routed to one connection's current runtime. */
export type ConnectionRpcContext = Omit<BridgeRpcContext, "route"> & {
  route: Extract<RpcRoute, { scope: "connection" }>;
  connection: LegacyConnectionRuntime;
};
