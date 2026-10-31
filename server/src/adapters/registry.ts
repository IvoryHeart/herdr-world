import { herdrAdapter } from "./herdr";
import { createLegacyConnectionRuntime } from "../connections/runtime";

/** Static production composition. No runtime plugin loader or test registration. */
export const productionAdapters = Object.freeze({
  herdr: { ...herdrAdapter, createRuntime: createLegacyConnectionRuntime },
});

export function productionAdapterDescriptors() {
  // Return data only, never runtime factories, credentials or configuration values.
  return Object.values(productionAdapters).map(({ descriptor }) =>
    structuredClone(descriptor),
  );
}
