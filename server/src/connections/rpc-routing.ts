import type { LegacyConnectionRuntime } from "./runtime";
import { CONNECTION_CHANGED_DURING_REQUEST } from "./protocol";
import {
  isBridgeGlobalMethod,
  type LegacyRoutingLogger,
  type ReadyConnectionRegistry,
  resolveReadyConnection,
} from "./protocol";

export type ConnectionRpcRequest = {
  focused_observation?: unknown;
  accept_world_snapshot_chunks?: unknown;
  accept_world_snapshot_chunk_admission?: unknown;
  id: string;
  method: string;
  params?: Record<string, unknown>;
  connection_id?: unknown;
  connection_generation?: unknown;
};

export function isConnectionRpcEnvelope(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export type ResolvedRpcRoute<Runtime> =
  | {
      scope: "bridge";
    }
  | {
      scope: "connection";
      connectionId: string;
      generation: number;
      runtime: Runtime;
      isCurrent(): boolean;
      usedLegacyDefault: boolean;
    };

export function resolveRpcRoute<Runtime>(args: {
  request: ConnectionRpcRequest;
  registry: ReadyConnectionRegistry<Runtime>;
  legacyClient: object;
  legacyLogger?: LegacyRoutingLogger;
}): ResolvedRpcRoute<Runtime> {
  if (isBridgeGlobalMethod(args.request.method)) {
    if (
      Object.hasOwn(args.request, "connection_id") ||
      Object.hasOwn(args.request, "connection_generation")
    ) {
      throw new Error(
        "bridge-global method must not include connection identity",
      );
    }
    return { scope: "bridge" };
  }
  const resolved = resolveReadyConnection(
    args.registry,
    args.request.connection_id,
    args.request.connection_generation,
  );
  if (args.request.connection_id === undefined) {
    args.legacyLogger?.rpc(
      args.legacyClient,
      args.request.method,
      resolved.connectionId,
    );
  }
  if (args.request.connection_generation === undefined) {
    args.legacyLogger?.rpcGeneration(
      args.legacyClient,
      args.request.method,
      resolved.connectionId,
    );
  }
  return {
    scope: "connection",
    ...resolved,
  };
}

/** Keep the session mutation on the same captured route as its preview. */
export function dispatchAgentSessionLink(
  route: Extract<
    ResolvedRpcRoute<Pick<LegacyConnectionRuntime, "agentSessions">>,
    { scope: "connection" }
  >,
  method: "agent_session.link_preview" | "agent_session.link",
  params: Record<string, unknown>,
) {
  if (!route.isCurrent()) throw new Error(CONNECTION_CHANGED_DURING_REQUEST);
  return method === "agent_session.link_preview"
    ? route.runtime.agentSessions.previewLink(params)
    : route.runtime.agentSessions.link(params, route.isCurrent);
}
