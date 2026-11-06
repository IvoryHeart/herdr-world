import type { GuiSettingsStore } from "../config/gui-settings";
import type { Logger } from "../utils/logger";
import { OfficeObservabilityService } from "../world/observability";
import {
  createOfficeObservabilityHttpHandler,
  resolveOfficeObservabilityBootstrap,
  withOfficeObservabilityEndpoint,
} from "../world/observability-http";

/** The configured comparison connector retains its existing HTTP/settings contract. */
export async function createUsageTelemetry(
  settings: GuiSettingsStore,
  now: () => number,
  logger: Logger,
) {
  const bootstrap = await settings
    .read()
    .then((current) => resolveOfficeObservabilityBootstrap(current))
    .catch(() => {
      logger.warn("invalid Office observability configuration was disabled");
      return { endpoint: null, source: "none" as const };
    });
  const officeObservability = new OfficeObservabilityService({
    ...bootstrap,
    now,
  });
  const handleOfficeObservability = createOfficeObservabilityHttpHandler({
    service: officeObservability,
    persist: async (endpoint) => {
      await settings.update((current) =>
        withOfficeObservabilityEndpoint(current, endpoint),
      );
    },
  });
  return { officeObservability, handleOfficeObservability };
}
