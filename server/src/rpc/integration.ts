import { type CliRuntime, currentRuntime } from "../cli/command";
import {
  installWorldIntegration,
  isWorldHarness,
  uninstallWorldIntegration,
  worldIntegrationStatus,
} from "../cli/integration";
import { WORLD_HARNESSES } from "../cli/integration-paths";
import type { BridgeRpcContext } from "./context";

/**
 * World's own skill per harness on the service's host (world.integration.*).
 * Settings runs the same installer as `herdr-world integration`; the service
 * user's environment decides the folders, exactly as for the CLI.
 */
export async function handleWorldIntegrationRpc(
  rpc: BridgeRpcContext,
): Promise<void> {
  const { id, method, params, sendError, sendReply } = rpc;
  try {
    const runtime: CliRuntime =
      rpc.services.worldIntegrationRuntime?.() ?? currentRuntime();
    if (method === "world.integration.list") {
      sendReply(
        {
          id,
          result: {
            integrations: WORLD_HARNESSES.map((harness) =>
              worldIntegrationStatus(harness, runtime),
            ),
          },
        },
        method,
      );
      return;
    }
    const harness = (params as { harness?: unknown } | undefined)?.harness;
    if (!isWorldHarness(harness))
      throw new Error(`unknown harness: ${String(harness)}`);
    if (method === "world.integration.install")
      installWorldIntegration(harness, runtime);
    else if (method === "world.integration.uninstall")
      uninstallWorldIntegration(harness, runtime);
    else throw new Error(`unknown World integration method: ${method}`);
    sendReply(
      {
        id,
        result: { integration: worldIntegrationStatus(harness, runtime) },
      },
      method,
    );
  } catch (error) {
    sendError(`${method}-error`, error);
  }
}
