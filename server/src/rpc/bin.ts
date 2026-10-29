import type { BinAdd } from "../world/bin";
import type { BridgeRpcContext } from "./context";

/**
 * The agent bin (world.bin.*). Adding checks that the pane is still that
 * terminal on its current runtime; the close itself waits for the countdown.
 */
export async function handleBinRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const { worldBin, connectionManager, profiles } = rpc.services;
  const p = (params ?? {}) as Record<string, unknown>;
  try {
    if (method === "world.bin.list")
      return void sendReply({ id, result: worldBin.list() }, "world-bin");
    if (method === "world.bin.pause")
      return void sendReply({ id, result: worldBin.pause() }, "world-bin");
    if (method === "world.bin.resume")
      return void sendReply({ id, result: worldBin.resume() }, "world-bin");
    if (method === "world.bin.restore")
      return void sendReply(
        { id, result: worldBin.restore(String(p.id ?? "")) },
        "world-bin",
      );
    if (method === "world.bin.close_now")
      return void sendReply(
        { id, result: worldBin.closeNow(String(p.id ?? "")) },
        "world-bin",
      );
    if (method !== "world.bin.add") throw new Error("unknown bin operation");
    const target = p as unknown as BinAdd;
    if (
      typeof target.connection_id !== "string" ||
      !Number.isSafeInteger(target.connection_generation)
    )
      throw new Error("invalid bin target");
    const lease = connectionManager.readyRuntimeLease(target.connection_id);
    if (
      !lease ||
      lease.generation !== target.connection_generation ||
      !lease.isCurrent()
    )
      throw new Error("That agent's host is unavailable");
    const result = await lease.runtime.herdr.call("pane.list", {}, 5_000);
    const panes = (result as { panes?: Record<string, unknown>[] })?.panes;
    const pane = Array.isArray(panes)
      ? panes.find((item) => item?.pane_id === target.pane_id)
      : undefined;
    if (
      !lease.isCurrent() ||
      !pane ||
      pane.terminal_id !== target.terminal_id ||
      pane.tab_id !== target.tab_id ||
      pane.workspace_id !== target.workspace_id
    )
      throw new Error("That agent has already closed or moved");
    const seconds = profiles().get().bin_countdown_s;
    sendReply(
      { id, result: worldBin.add(target, seconds * 1000) },
      "world-bin",
    );
  } catch (error) {
    sendError("world-bin-error", error);
  }
}
