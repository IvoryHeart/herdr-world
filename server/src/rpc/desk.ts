import { validDeskIdentity } from "../../../shared/deskState";
import { deskSessionFingerprint } from "../world/desk-observation";
import type { BridgeRpcContext } from "./context";

/** Service-owned metadata only; this never sends input to an agent. */
export async function handleDeskRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const { worldDesk, publishDeskChanged, connectionManager } = rpc.services;
  const revision = worldDesk.list().revision;
  try {
    worldDesk.expire(Date.now());
    if (method !== "world.desk.get") {
      if (method !== "world.desk.review" && method !== "world.desk.open")
        throw new Error("unknown Desk operation");
      if (!validDeskIdentity(params))
        throw new Error("invalid Desk agent identity");
      const identity = params;
      const mutation = params as typeof params & {
        reviewed?: unknown;
        stop_id?: unknown;
      };
      const lease = connectionManager.readyRuntimeLease(identity.connection_id);
      if (
        !lease ||
        lease.generation !== identity.connection_generation ||
        !lease.isCurrent()
      )
        throw new Error("Desk agent is unavailable");
      const mutationIsCurrent = worldDesk.captureMutation(identity);
      const result = await lease.runtime.herdr.call("pane.list", {}, 5_000);
      const panes = (result as { panes?: unknown })?.panes;
      const matches = Array.isArray(panes)
        ? panes.filter((pane) => pane?.terminal_id === identity.terminal_id)
        : [];
      if (
        !lease.isCurrent() ||
        !mutationIsCurrent() ||
        matches.length !== 1 ||
        !matches[0].agent ||
        deskSessionFingerprint(matches[0].agent_session) !==
          identity.agent_session_fingerprint
      )
        throw new Error("Desk agent session changed");
      if (method === "world.desk.review") {
        if (
          typeof mutation.reviewed !== "boolean" ||
          typeof mutation.stop_id !== "string"
        )
          throw new Error("invalid Desk review mark");
        worldDesk.mark(
          identity,
          mutation.stop_id,
          mutation.reviewed,
          Date.now(),
        );
      } else worldDesk.open(identity, Date.now());
    }
    sendReply({ id, result: worldDesk.list() }, "world-desk");
  } catch (error) {
    sendError("world-desk-error", error);
  } finally {
    const next = worldDesk.list().revision;
    if (next !== revision) publishDeskChanged(next);
  }
}
