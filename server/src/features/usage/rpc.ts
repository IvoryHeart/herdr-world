import { UsageQueryError } from "./errors";
import type { FeatureRpcHandler } from "../contract";

type Reads = {
  get?(params: Record<string, unknown>): Promise<unknown>;
  analytics?: { get(params: Record<string, unknown>): Promise<unknown> };
};
export const usageRpc = (usage: Reads): Record<string, FeatureRpcHandler> => ({
  "world.usage.analytics": async (rpc) => {
    const { id, method, params, sendError, sendReply } = rpc;
    try {
      const analytics = usage.analytics;
      if (!analytics) throw new Error("unavailable");
      sendReply({ id, result: await analytics.get(params ?? {}) }, method);
    } catch (error) {
      sendError(
        "world-usage-error",
        error instanceof UsageQueryError
          ? error
          : new Error("World usage analytics is unavailable"),
      );
    }
  },
  "world.usage.get": async ({ id, method, params, sendError, sendReply }) => {
    try {
      if (!usage.get) throw new Error("World usage service is unavailable");
      sendReply({ id, result: await usage.get(params ?? {}) }, method);
    } catch {
      sendError("world-usage-error", new Error("World usage is unavailable"));
    }
  },
});
