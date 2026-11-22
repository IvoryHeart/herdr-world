import type { BridgeRpcContext } from "./context";

/**
 * The Code view's installed IDEs (world.ide.*): detection and the enable
 * gate, the owner's program path, and World-owned servers per project
 * folder. Starting is always an explicit open and stopping an explicit
 * Stop; nothing here installs or downloads an IDE.
 */
export async function handleIdeRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, sendError, sendReply } = rpc;
  const params = (rpc.params ?? {}) as Record<string, unknown>;
  try {
    const ide = rpc.services.ide;
    if (!ide) throw new Error("IDE integrations are unavailable");
    if (method === "world.ide.status") {
      sendReply(
        { id, result: await ide.status({ refresh: params.refresh === true }) },
        method,
      );
      return;
    }
    if (method === "world.ide.enable")
      await ide.enable(params.provider, {
        trust: params.trust,
        acceptTerms: params.acceptTerms,
      });
    else if (method === "world.ide.disable") await ide.disable(params.provider);
    else if (method === "world.ide.configure")
      await ide.configure(params.provider, params.binary ?? null);
    else if (method === "world.ide.open") {
      sendReply(
        {
          id,
          result: await ide.open({
            provider: params.provider,
            connectionId: params.connectionId,
            generation: params.generation,
            folder: params.folder,
          }),
        },
        method,
      );
      return;
    } else if (method === "world.ide.stop") await ide.stop(params.instanceId);
    else if (method === "world.ide.forget") ide.forget(params.instanceId);
    else throw new Error(`unknown IDE method: ${method}`);
    sendReply({ id, result: await ide.status() }, method);
  } catch (error) {
    sendError(`${method}-error`, error);
  }
}
