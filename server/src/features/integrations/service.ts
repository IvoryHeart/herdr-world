import type { CliRuntime } from "../../cli/command";
import { withIntegrations } from "../../integrations/http";
import type { FeatureRpcHandler } from "../contract";
import { handleWorldIntegrationRpc } from "./rpc";

/** Keep installer dependencies outside the storage worker's feature discovery. */
export function createIntegrations(
  sources: Parameters<typeof withIntegrations>[0],
  owners: Parameters<typeof withIntegrations>[1],
  runtime?: () => CliRuntime,
) {
  return {
    http: withIntegrations(sources, owners),
    rpc: (rpc: Parameters<FeatureRpcHandler>[0]) =>
      handleWorldIntegrationRpc(rpc, runtime),
  };
}
