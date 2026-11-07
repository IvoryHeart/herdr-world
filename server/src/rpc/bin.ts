import { binEmptiesTab } from "../../../shared/bin";
import type { BinAdd } from "../world/bin";
import type { BridgeRpcContext } from "./context";

/**
 * The agent bin (world.bin.*). Every method changes only the reversible,
 * in-memory holding; Herdr is reached only by the durable close intent
 * recorded when the bus leaves the map or on Close now.
 */
export async function handleBinRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const bin = rpc.services.bin;
  const p = (params ?? {}) as Record<string, unknown>;
  const reply = (result: unknown) => {
    sendReply({ id, result }, "world-bin");
  };
  try {
    if (!bin) throw new Error("The bin needs World storage");
    const { registry } = bin;
    if (method === "world.bin.list") return reply(registry.list());
    if (method === "world.bin.restore")
      return reply(registry.restore(String(p.id)));
    if (method === "world.bin.pause") return reply(registry.stopBus());
    if (method === "world.bin.resume") return reply(registry.goBus());
    if (method === "world.bin.close_now")
      return reply(
        registry.closeNow(
          Array.isArray(p.ids) ? p.ids.map((id) => String(id)) : [],
        ),
      );
    if (method !== "world.bin.add") throw new Error("unknown bin operation");
    const target = p as unknown as BinAdd;
    // Admission: the pane must still be this terminal on its current runtime.
    const lease = bin.lease(target.connection_id);
    if (
      !lease ||
      lease.generation !== target.connection_generation ||
      !lease.isCurrent()
    )
      throw new Error("That agent's host is unavailable");
    const result = (await lease.call(
      "pane.list",
      { workspace_id: target.workspace_id },
      5_000,
    )) as { panes?: Record<string, unknown>[] } | null;
    const pane = Array.isArray(result?.panes)
      ? result.panes.find((item) => item?.pane_id === target.pane_id)
      : undefined;
    if (
      !lease.isCurrent() ||
      !pane ||
      pane.terminal_id !== target.terminal_id ||
      pane.tab_id !== target.tab_id ||
      pane.workspace_id !== target.workspace_id
    )
      throw new Error("That agent has already closed or moved");
    // A pinned tab keeps its last pane: refuse now rather than at the bus.
    if (
      target.preserve_tab === true &&
      binEmptiesTab(
        target,
        result!.panes!.filter(
          (item) =>
            item?.workspace_id === target.workspace_id &&
            item?.tab_id === target.tab_id &&
            typeof item?.pane_id === "string",
        ) as { pane_id: string }[],
        registry.holds(target),
      )
    )
      throw new Error(
        "A pinned tab keeps its last agent; unpin its desk first",
      );
    reply(registry.add(target));
  } catch (error) {
    sendError("world-bin-error", error);
  }
}
